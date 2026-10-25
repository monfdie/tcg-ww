const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const TournamentGlobalBan = require('../models/TournamentGlobalBan');
const User = require('../models/User');
const { validateGlobalBans } = require('../lib/global-bans');
const CHARACTERS_BY_ELEMENT = require('../characters.json');
const GLOBAL_BAN_CHARACTERS = ['cryo', 'hydro', 'pyro', 'electro', 'anemo', 'geo', 'dendro']
    .flatMap(element => CHARACTERS_BY_ELEMENT[element] || []);

function getChallongeEmbedUrl(link) {
    try {
        const url = new URL(link);
        if (!/^([a-z0-9-]+\.)?challonge\.com$/i.test(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        const pathname = url.pathname.replace(/\/+$/, '').replace(/\/bracket$/i, '');
        if (!pathname || pathname === '/') return null;
        url.protocol = 'https:';
        url.pathname = pathname.endsWith('/module') ? pathname : `${pathname}/module`;
        url.search = '';
        url.hash = '';
        url.searchParams.set('scale_to_fit', '1');
        return url.toString();
    } catch { return null; }
}

const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function(req, file, cb) { cb(null, 'post-' + Date.now() + path.extname(file.originalname)); }
});

const upload = multer({ storage: storage, limits: { fileSize: 5000000 } });
const urlencodedParser = express.urlencoded({ extended: false });

function isAdmin(req, res, next) {
    if (req.isAuthenticated() && (req.user.discordId === process.env.ADMIN_DISCORD_ID || req.user.role === 'admin')) {
        return next();
    }
    res.redirect('/');
}

router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    res.locals.isAdmin = req.isAuthenticated() && (req.user.discordId === process.env.ADMIN_DISCORD_ID || req.user.role === 'admin');
    next();
});

// Independent virtual-points events; no draft or tournament state is shared.
router.use('/bets', require('../routes/betting'));

// ==========================================
// ЛОГИКА TIERLIST
// ==========================================
const PlayerTierlist = require('../models/PlayerTierlist');

async function getTierlistVersions() {
    const docs = await PlayerTierlist.find({}, 'key').lean();
    let versions = docs.map(d => d.key).filter(k => k && k !== 'official');
    
    versions.sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
        return b.localeCompare(a);
    });
    
    if (versions.length === 0) return ['1.0'];
    return versions;
}

async function getTierlistData(versionKey) {
    try {
        let doc = await PlayerTierlist.findOne({ key: versionKey });
        if (!doc && versionKey === '1.0') {
            doc = await PlayerTierlist.findOne({ key: 'official' });
        }
        if (!doc) {
            return { t0: [], t1: [], t2: [], t3: [], t4: [], unassigned: [] };
        }
        return doc.data;
    } catch (e) {
        return { t0: [], t1: [], t2: [], t3: [], t4: [], unassigned: [] };
    }
}

router.get('/tierlist', async (req, res) => {
    const versions = await getTierlistVersions();
    let currentVersion = req.query.v || versions[0];
    if (!versions.includes(currentVersion)) currentVersion = versions[0];

    const tierlistData = await getTierlistData(currentVersion);

    const currentIndex = versions.indexOf(currentVersion);
    const nextVersion = currentIndex > 0 ? versions[currentIndex - 1] : null;
    const prevVersion = currentIndex < versions.length - 1 ? versions[currentIndex + 1] : null;

    res.render('pages/tierlist', { 
        title: `Tierlist v${currentVersion}`, 
        tierlistData, 
        currentVersion, 
        prevVersion, 
        nextVersion 
    });
});

router.get('/admin/tierlist', isAdmin, async (req, res) => {
    const versions = await getTierlistVersions();
    let currentVersion = req.query.v || versions[0];
    if (!versions.includes(currentVersion)) currentVersion = versions[0];

    const tierlistData = await getTierlistData(currentVersion);
    
    // Подгружаем данные предыдущей версии для авторасчета трендов
    const currentIndex = versions.indexOf(currentVersion);
    const prevVersion = currentIndex < versions.length - 1 ? versions[currentIndex + 1] : null;
    let prevTierlistData = null;
    if (prevVersion) {
        prevTierlistData = await getTierlistData(prevVersion);
    }
    
    res.render('pages/admin_tierlist', { 
        title: 'Manage Tierlist', 
        tierlistData, 
        currentVersion, 
        versions,
        prevVersion,
        prevTierlistData
    });
});

router.post('/admin/tierlist/save', isAdmin, express.json(), async (req, res) => {
    try {
        const version = (req.body.version || '1.0').trim();
        await PlayerTierlist.findOneAndUpdate(
            { key: version }, 
            { data: req.body.data }, 
            { upsert: true }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save tierlist' });
    }
});

router.post('/admin/tierlist/rename', isAdmin, express.json(), async (req, res) => {
    try {
        const oldVersion = (req.body.oldVersion || '').trim();
        const newVersion = (req.body.newVersion || '').trim();

        if (!oldVersion || !newVersion) {
            return res.status(400).json({ error: 'Both old and new version names are required' });
        }

        const existing = await PlayerTierlist.findOne({ key: newVersion });
        if (existing) {
            return res.status(400).json({ error: `Version "${newVersion}" already exists` });
        }

        let doc = await PlayerTierlist.findOne({ key: oldVersion });
        if (!doc && oldVersion === '1.0') {
            doc = await PlayerTierlist.findOne({ key: 'official' });
        }

        if (!doc) {
            return res.status(404).json({ error: 'Version not found' });
        }

        doc.key = newVersion;
        await doc.save();

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to rename tierlist version' });
    }
});

router.post('/admin/tierlist/delete', isAdmin, express.json(), async (req, res) => {
    try {
        const version = (req.body.version || '').trim();
        if (!version) {
            return res.status(400).json({ error: 'Version name is required' });
        }

        await PlayerTierlist.findOneAndDelete({ key: version });
        if (version === '1.0') {
            await PlayerTierlist.findOneAndDelete({ key: 'official' });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete tierlist version' });
    }
});

// ==========================================
// ГЛАВНАЯ, ТУРНИРЫ
// ==========================================
router.get('/', async (req, res) => {
    try {
        const tournaments = await Tournament.find().sort({ createdAt: -1 }).lean();
        res.render('pages/home', {
            tournaments: tournaments || [],
            user: req.user || null
        });
    } catch (err) {
        console.error('Home route error:', err);
        res.render('pages/home', { 
            tournaments: [], 
            user: req.user || null 
        });
    }
});

router.get('/create', async (req, res) => {
    const globalBanTournaments = await Tournament.find({ type: 'tournament', isLive: true, isMine: true, globalBansEnabled: true })
        .select('title slug globalBansLocked').sort({ createdAt: -1 }).lean();
    res.render('pages/create', { title: 'Create Game', globalBanTournaments, selectedTournament: req.query.tournament || '' });
});

router.get('/tournaments', async (req, res) => {
    try {
        const activeTournaments = await Tournament.find({ type: 'tournament', isLive: true }).sort({ createdAt: -1 });
        const archivedTournaments = await Tournament.find({ type: 'tournament', isLive: false }).sort({ createdAt: -1 });
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: activeTournaments, archive: archivedTournaments });
    } catch (e) {
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: [], archive: [] });
    }
});

router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');
        if (tour.isMine === false) return res.redirect('/tournaments');
        const myGlobalBans = tour.globalBansEnabled && req.user
            ? await TournamentGlobalBan.findOne({ tournamentId: tour._id, discordId: req.user.discordId }).lean() : null;

        const roomIds = tour.matches ? tour.matches.map(m => m.roomId) : [];
        const dbMatches = await Match.find({ roomId: { $in: roomIds } });

        const enrichedMatches = (tour.matches || []).map(tm => {
            const found = dbMatches.find(m => m.roomId === tm.roomId);
            return {
                ...tm, score: found ? found.score : null,
                blueName: found ? found.blueName : 'Player 1',
                redName: found ? found.redName : 'Player 2', date: found ? found.date : null
            };
        });

        const deckStats = { 1: [], 2: [], 3: [] };
        const charStats = { 1: [], 2: [], 3: [] };
        const deckCounts = { 1: {}, 2: {}, 3: {} };
        const charCounts = { 1: {}, 2: {}, 3: {} };

        if (tour.groups && tour.groups.length > 0) {
            tour.groups.forEach(group => {
                const stage = group.stage || 1;
                if (!deckCounts[stage]) deckCounts[stage] = {};
                if (!charCounts[stage]) charCounts[stage] = {};

                if (group.players && group.players.length > 0) {
                    group.players.forEach(player => {
                        if (player.decks && Array.isArray(player.decks)) {
                            player.decks.forEach(deck => {
                                if (deck && deck.length === 3) {
                                    const validDeck = deck.filter(id => id && id.trim() !== '');
                                    if (validDeck.length === 3) {
                                        const sortedDeckKey = [...validDeck].sort().join(',');
                                        deckCounts[stage][sortedDeckKey] = (deckCounts[stage][sortedDeckKey] || 0) + 1;

                                        validDeck.forEach(charId => {
                                            charCounts[stage][charId] = (charCounts[stage][charId] || 0) + 1;
                                        });
                                    }
                                }
                            });
                        }
                    });
                }
            });

            for (let stage in deckCounts) {
                deckStats[stage] = Object.keys(deckCounts[stage]).map(key => ({
                    deck: key.split(','),
                    count: deckCounts[stage][key]
                })).sort((a, b) => b.count - a.count);

                charStats[stage] = Object.keys(charCounts[stage]).map(charId => ({
                    charId: charId,
                    count: charCounts[stage][charId]
                })).sort((a, b) => b.count - a.count);
            }
        }

        res.render('pages/tournament_view', {
            title: tour.title,
            tour: tour,
            matches: enrichedMatches,
            deckStats: deckStats,
            charStats: charStats,
            chars: CHARACTERS_BY_ELEMENT,
            allCharsForGlobalBans: GLOBAL_BAN_CHARACTERS,
            myGlobalBans,
            challongeEmbedUrl: getChallongeEmbedUrl(tour.bracketLink)
        });
    } catch (err) {
        console.error(err);
        res.redirect('/tournaments');
    }
});

router.post('/tournament/:slug/global-bans', express.json(), async (req, res) => {
    if (!req.user?.discordId) return res.status(401).json({ error: 'Sign in with Discord first.' });
    const tour = await Tournament.findOne({ slug: req.params.slug, type: 'tournament', isMine: true, isLive: true, globalBansEnabled: true });
    if (!tour) return res.status(404).json({ error: 'Global bans are unavailable for this tournament.' });
    if (tour.globalBansLocked) return res.status(409).json({ error: 'Player selections are locked for this tournament.' });
    if (!validateGlobalBans(req.body.characterIds, tour.globalBanCount)) {
        return res.status(400).json({ error: `Choose ${tour.globalBanCount} different characters.` });
    }
    await TournamentGlobalBan.updateOne(
        { tournamentId: tour._id, discordId: req.user.discordId },
        { $set: { characterIds: req.body.characterIds, updatedAt: new Date() } },
        { upsert: true }
    );
    res.json({ success: true });
});

router.get('/tournament/:slug/group/:groupId', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');
        
        const group = tour.groups.id(req.params.groupId);
        if (!group) return res.status(404).send('Group not found');

        const sortedPlayers = [...group.players].sort((a, b) => b.points - a.points);

        res.render('pages/group_view', { 
            title: `${group.name} - ${tour.title}`, 
            tour: tour, 
            group: group,
            players: sortedPlayers,
            chars: CHARACTERS_BY_ELEMENT 
        });
    } catch (err) { res.redirect('/tournaments'); }
});

router.get('/history', async (req, res) => {
    try {
        let matches = [];
        if (req.user) {
            matches = await Match.find({ $or: [ { blueDiscordId: req.user.discordId }, { redDiscordId: req.user.discordId } ] }).sort({ date: -1 }).limit(9);
        }
        res.render('pages/history', { title: 'My History', matches });
    } catch (e) { res.render('pages/history', { title: 'History', matches: [] }); }
});

router.get('/admin/dashboard', isAdmin, async (req, res) => {
    const tournaments = await Tournament.find().sort({ createdAt: -1 });
    res.render('pages/admin_dashboard', { tournaments });
});

router.get('/admin/add-tournament', isAdmin, (req, res) => { res.render('pages/admin_add_tournament', { title: 'Add Tournament' }); });
router.post('/admin/add-tournament', isAdmin, upload.single('image'), async (req, res) => {
    try {
        const data = req.body;
        data.type = 'tournament'; data.image = req.file ? req.file.filename : ''; data.isMine = data.isMine === 'on'; data.isLive = true;
        data.globalBansEnabled = data.globalBansEnabled === 'on';
        data.globalBansLocked = false;
        data.globalBanCount = Number(data.globalBanCount) || 3;
        if (!Number.isInteger(data.globalBanCount) || data.globalBanCount < 1 || data.globalBanCount > 10) return res.status(400).send('Global ban count must be between 1 and 10.');
        await Tournament.create(data); res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send(`Error: ${err.message}`); }
});

router.get('/admin/add-announcement', isAdmin, (req, res) => { res.render('pages/admin_add_announcement', { title: 'Add Announcement' }); });
router.post('/admin/add-announcement', isAdmin, upload.single('image'), async (req, res) => {
    try {
        let slug = req.body.slug && req.body.slug.trim() !== '' ? req.body.slug : 'news-' + Date.now();
        await Tournament.create({ type: 'announcement', slug: slug, title: req.body.title, image: req.file ? req.file.filename : '', description: req.body.description, regLink: req.body.regLink, isLive: true, date: new Date().toLocaleDateString() });
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send(`Error: ${err.message}`); }
});

router.post('/admin/delete/:id', isAdmin, async (req, res) => {
    try { await Tournament.findByIdAndDelete(req.params.id); res.redirect('/admin/dashboard'); } catch (e) { res.send("Error: " + e.message); }
});

router.get('/admin/manage/:slug', isAdmin, async (req, res) => {
    const tour = await Tournament.findOne({ slug: req.params.slug });
    if(!tour) return res.send("Tournament not found");
    const globalBanEntries = await TournamentGlobalBan.find({ tournamentId: tour._id }).lean();
    const banUsers = await User.find({ discordId: { $in: globalBanEntries.map(entry => entry.discordId) } }).select('discordId username').lean();
    const names = new Map(banUsers.map(user => [user.discordId, user.username]));
    res.render('pages/admin_manage', { tour: tour, chars: CHARACTERS_BY_ELEMENT,
        allCharsForGlobalBans: GLOBAL_BAN_CHARACTERS,
        globalBanEntries: globalBanEntries.map(entry => ({ ...entry, username: names.get(entry.discordId) || entry.discordId })) });
});

router.get('/admin/tournament/:id/global-bans/player/:discordId', isAdmin, async (req, res) => {
    const tour = await Tournament.findById(req.params.id);
    if (!tour?.globalBansEnabled) return res.status(404).json({ error: 'Global bans are unavailable.' });
    const discordId = req.params.discordId.trim();
    if (!discordId || discordId.length > 64) return res.status(400).json({ error: 'Enter a valid Discord ID.' });
    const player = await User.findOne({ discordId });
    if (!player) return res.status(404).json({ error: 'Player with this Discord ID was not found.' });
    const entry = await TournamentGlobalBan.findOne({ tournamentId: tour._id, discordId });
    res.json({ discordId, username: player.username || discordId, characterIds: entry?.characterIds || [] });
});

router.post('/admin/tournament/:id/global-bans/:discordId', isAdmin, express.json(), async (req, res) => {
    const tour = await Tournament.findById(req.params.id);
    if (!tour?.globalBansEnabled) return res.status(404).json({ error: 'Global bans are unavailable.' });
    const discordId = req.params.discordId.trim();
    if (!discordId || discordId.length > 64) return res.status(400).json({ error: 'Enter a valid Discord ID.' });
    const player = await User.findOne({ discordId });
    if (!player) return res.status(404).json({ error: 'Player with this Discord ID was not found.' });
    if (!validateGlobalBans(req.body.characterIds, tour.globalBanCount)) return res.status(400).json({ error: 'Invalid character selection.' });
    await TournamentGlobalBan.updateOne(
        { tournamentId: tour._id, discordId },
        { $set: { characterIds: req.body.characterIds, updatedAt: new Date() } }, { upsert: true }
    );
    res.json({ success: true });
});

router.post('/admin/edit/:id', isAdmin, upload.single('image'), async (req, res) => {
    try {
        const updateData = { ...req.body, isMine: req.body.isMine === 'on', isLive: req.body.isLive === 'on',
            globalBansEnabled: req.body.globalBansEnabled === 'on', globalBansLocked: req.body.globalBansLocked === 'on',
            globalBanCount: Number(req.body.globalBanCount) || 3 };
        if (!Number.isInteger(updateData.globalBanCount) || updateData.globalBanCount < 1 || updateData.globalBanCount > 10) return res.status(400).send('Global ban count must be between 1 and 10.');
        if (req.file) updateData.image = req.file.filename;

        let newMatches = [];
        if (req.body.matchStage) {
            let stages = Array.isArray(req.body.matchStage) ? req.body.matchStage : [req.body.matchStage];
            let titles = Array.isArray(req.body.matchTitle) ? req.body.matchTitle : [req.body.matchTitle];
            let roomIds = Array.isArray(req.body.matchRoomId) ? req.body.matchRoomId : [req.body.matchRoomId];
            for (let i = 0; i < stages.length; i++) {
                if (stages[i] && roomIds[i]) newMatches.push({ stage: stages[i].trim(), title: titles[i].trim(), roomId: roomIds[i].trim() });
            }
        }
        updateData.matches = newMatches;
        await Tournament.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send('Error: ' + err.message); }
});

router.post('/admin/edit-groups/:id', isAdmin, express.json(), async (req, res) => {
    try {
        await Tournament.findByIdAndUpdate(req.params.id, { groups: req.body.groups });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save groups' });
    }
});

router.get('/game/:id', async (req, res) => {
    try {
        const matches = req.app.locals.isLiveDraftRoom(req.params.id) ? [] :
            await Match.find({ roomId: req.params.id }).sort({ gameNumber: 1 }).lean();
        res.render('pages/game', { title: `Room ${req.params.id}`, roomId: req.params.id, savedData: matches[0] || null,
            savedSeries: matches, initialGame: Number(req.query.game) || 1, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true });
    } catch (e) { res.render('pages/game', { title: "Error", roomId: req.params.id, savedData: null,
        savedSeries: [], initialGame: 1, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true }); }
});

router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => { res.redirect('/'); });
router.get('/logout', (req, res, next) => { req.logout((err) => { if (err) return next(err); res.redirect('/'); }); });

module.exports = router;
