const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const CHARACTERS_BY_ELEMENT = require('../characters.json');

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

// ==========================================
// ЛОГИКА TIERLIST
// ==========================================
const PlayerTierlist = require('../models/PlayerTierlist');

async function getTierlistData() {
    try {
        let doc = await PlayerTierlist.findOne({ key: 'official' });
        if (!doc) {
            const defaultData = { t0: [], t1: [], t2: [], t3: [], t4: [], unassigned: [] };
            doc = await PlayerTierlist.create({ key: 'official', data: defaultData });
        }
        return doc.data;
    } catch (e) {
        return { t0: [], t1: [], t2: [], t3: [], t4: [], unassigned: [] };
    }
}

router.get('/tierlist', async (req, res) => {
    const tierlistData = await getTierlistData();
    res.render('pages/tierlist', { title: 'Player Tierlist', tierlistData });
});

router.get('/admin/tierlist', isAdmin, async (req, res) => {
    const tierlistData = await getTierlistData();
    res.render('pages/admin_tierlist', { title: 'Manage Tierlist', tierlistData });
});

router.post('/admin/tierlist/save', isAdmin, express.json(), async (req, res) => {
    try {
        await PlayerTierlist.findOneAndUpdate({ key: 'official' }, { data: req.body }, { upsert: true });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save tierlist' });
    }
});

// ==========================================
// ГЛАВНАЯ, ТУРНИРЫ, ПРОФИЛЬ
// ==========================================
router.get('/', async (req, res) => {
    try {
        // Загружаем турниры из базы
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

router.get('/create', (req, res) => { res.render('pages/create', { title: 'Create Game' }); });

router.get('/tournaments', async (req, res) => {
    try {
        const activeTournaments = await Tournament.find({ type: 'tournament', isLive: true }).sort({ createdAt: -1 });
        const archivedTournaments = await Tournament.find({ type: 'tournament', isLive: false }).sort({ createdAt: -1 });
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: activeTournaments, archive: archivedTournaments });
    } catch (e) {
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: [], archive: [] });
    }
});

// ПРОСМОТР ТУРНИРА
router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');
        if (tour.isMine === false) return res.redirect('/tournaments');

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

        res.render('pages/tournament_view', { title: tour.title, tour: tour, matches: enrichedMatches });
    } catch (err) { res.redirect('/tournaments'); }
});

// ПРОСМОТР КОНКРЕТНОЙ ГРУППЫ (ПУБЛИЧНАЯ)
router.get('/tournament/:slug/group/:groupId', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');
        
        const group = tour.groups.id(req.params.groupId);
        if (!group) return res.status(404).send('Group not found');

        // Сортируем игроков по очкам от большего к меньшему
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

const TierConfig = require('../models/TierConfig'); 

router.get('/profile', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/discord');
    let config = await TierConfig.findOne({ settingsKey: 'main' });
    if (!config) { config = await TierConfig.create({ settingsKey: 'main' }); }
    if (req.user.boxes.length === 1 && req.user.boxes[0].characters.length === 0 && req.user.box && req.user.box.length > 0) {
        req.user.boxes[0].characters = req.user.box;
        await req.user.save();
    }
    res.render('pages/profile', { title: 'My Profile', user: req.user, chars: CHARACTERS_BY_ELEMENT, tiers: config });
});

router.post('/profile/save-box', express.json(), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { boxes, activeBoxIndex } = req.body;
        req.user.boxes = boxes; req.user.activeBoxIndex = activeBoxIndex;
        if (boxes[activeBoxIndex]) req.user.box = boxes[activeBoxIndex].characters;
        await req.user.save(); res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ==========================================
// АДМИНКА
// ==========================================
router.get('/admin/tiers', isAdmin, async (req, res) => {
    let config = await TierConfig.findOne({ settingsKey: 'main' });
    if (!config) { config = await TierConfig.create({ settingsKey: 'main' }); }
    res.render('pages/admin_manage_tiers', { title: 'Manage Tiers', chars: CHARACTERS_BY_ELEMENT, tiers: config });
});

router.post('/admin/tiers/save', isAdmin, express.json(), async (req, res) => {
    try {
        await TierConfig.findOneAndUpdate({ settingsKey: 'main' }, req.body, { upsert: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
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
    // ПЕРЕДАЕМ ПЕРСОНАЖЕЙ В АДМИНКУ ДЛЯ ВЫБОРА КОЛОД
    res.render('pages/admin_manage', { tour: tour, chars: CHARACTERS_BY_ELEMENT });
});

router.post('/admin/edit/:id', isAdmin, upload.single('image'), async (req, res) => {
    try {
        const updateData = { ...req.body, isMine: req.body.isMine === 'on', isLive: req.body.isLive === 'on' };
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

// СОХРАНЕНИЕ ГРУПП (АЯКС ИЗ АДМИНКИ)
router.post('/admin/edit-groups/:id', isAdmin, express.json(), async (req, res) => {
    try {
        // req.body.groups - массив объектов групп
        await Tournament.findByIdAndUpdate(req.params.id, { groups: req.body.groups });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save groups' });
    }
});

router.get('/game/:id', async (req, res) => {
    try {
        const match = await Match.findOne({ roomId: req.params.id });
        res.render('pages/game', { title: `Room ${req.params.id}`, roomId: req.params.id, savedData: match || null, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true });
    } catch (e) { res.render('pages/game', { title: "Error", roomId: req.params.id, savedData: null, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true }); }
});

router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => { res.redirect('/'); });
router.get('/logout', (req, res, next) => { req.logout((err) => { if (err) return next(err); res.redirect('/'); }); });

module.exports = router;
