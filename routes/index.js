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

router.get('/', async (req, res) => {
    try {
        const today = new Date();
        const news = await Tournament.find({
            isLive: true,
            $or: [ { visibleUntil: { $exists: false } }, { visibleUntil: { $eq: null } }, { visibleUntil: { $gt: today } } ]
        }).sort({ date: 1 });
        res.render('pages/home', { title: 'Home', news });
    } catch (e) {
        res.render('pages/home', { title: 'Home', news: [] });
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

router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');
        
        if (tour.isMine === false) {
            return res.redirect('/tournaments');
        }

        const roomIds = tour.matches ? tour.matches.map(m => m.roomId) : [];
        const dbMatches = await Match.find({ roomId: { $in: roomIds } });

        const enrichedMatches = (tour.matches || []).map(tm => {
            const found = dbMatches.find(m => m.roomId === tm.roomId);
            return {
                ...tm,
                score: found ? found.score : null,
                blueName: found ? found.blueName : 'Player 1',
                redName: found ? found.redName : 'Player 2',
                date: found ? found.date : null
            };
        });

        res.render('pages/tournament_view', { title: tour.title, tour: tour, matches: enrichedMatches });
    } catch (err) {
        console.error(err);
        res.redirect('/tournaments');
    }
});

router.get('/history', async (req, res) => {
    try {
        let matches = [];
        if (req.user) {
            matches = await Match.find({ $or: [ { blueDiscordId: req.user.discordId }, { redDiscordId: req.user.discordId } ] })
                .sort({ date: -1 })
                .limit(9);
        }
        res.render('pages/history', { title: 'My History', matches });
    } catch (e) { res.render('pages/history', { title: 'History', matches: [] }); }
});

// ==========================================
// НОВЫЕ РОУТЫ: ПРОФИЛЬ И СБОРКА БОКСА
// ==========================================
router.get('/profile', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/discord'); // Требуем логин
    
    let tiers = { limits: { "0": 20, "1": 15, "2": 10, "3": 4, "4": 1 }, characters: {} };
    try {
        tiers = JSON.parse(fs.readFileSync(path.join(__dirname, '../tiers.json'), 'utf-8'));
    } catch(e) { console.log('tiers.json не найден, используем дефолт'); }

    res.render('pages/profile', { title: 'My Profile', user: req.user, chars: CHARACTERS_BY_ELEMENT, tiers });
});

router.post('/profile/save-box', express.json(), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { box } = req.body;
        if (!Array.isArray(box)) return res.status(400).json({ error: 'Invalid data' });
        
        req.user.box = box;
        await req.user.save();
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});
// ==========================================

router.get('/admin/dashboard', isAdmin, async (req, res) => {
    const tournaments = await Tournament.find().sort({ createdAt: -1 });
    res.render('pages/admin_dashboard', { tournaments });
});

router.get('/admin/add-tournament', isAdmin, (req, res) => {
    res.render('pages/admin_add_tournament', { title: 'Add Tournament' });
});

router.post('/admin/add-tournament', isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { title, slug, date, prize, isMine, region, format, description, regLink, rulesLink, rulesEnLink, discordLink, telegramLink, bracketLink } = req.body;
        const image = req.file ? req.file.filename : '';
        await Tournament.create({ 
            type: 'tournament', title, slug, date, prize, image,
            isMine: isMine === 'on', region, format, description,
            regLink, rulesLink, rulesEnLink, discordLink, telegramLink, bracketLink, isLive: true
        });
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send(`Error: ${err.message}`); }
});

router.get('/admin/add-announcement', isAdmin, (req, res) => {
    res.render('pages/admin_add_announcement', { title: 'Add Announcement' });
});

router.post('/admin/add-announcement', isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { title, description, slug, regLink } = req.body;
        let finalSlug = slug && slug.trim() !== '' ? slug : 'news-' + Date.now();
        let imageFilename = req.file ? req.file.filename : '';
        await Tournament.create({
            type: 'announcement', slug: finalSlug, title: title, image: imageFilename,
            description: description, regLink: regLink, isLive: true, date: new Date().toLocaleDateString()
        });
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send(`Error: ${err.message}`); }
});

router.post('/admin/delete/:id', isAdmin, async (req, res) => {
    try { await Tournament.findByIdAndDelete(req.params.id); res.redirect('/admin/dashboard'); } 
    catch (e) { res.send("Error: " + e.message); }
});

router.get('/admin/manage/:slug', isAdmin, async (req, res) => {
    const tour = await Tournament.findOne({ slug: req.params.slug });
    if(!tour) return res.send("Tournament not found");
    res.render('pages/admin_manage', { tour: tour });
});

router.post('/admin/edit/:id', isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { title, slug, date, prize, isMine, isLive, region, format, description, regLink, rulesLink, rulesEnLink, discordLink, telegramLink, bracketLink } = req.body;
        
        const updateData = { 
            title, slug, date, prize, 
            isMine: isMine === 'on', 
            isLive: isLive === 'on',
            region, format, description,
            regLink, rulesLink, rulesEnLink, discordLink, telegramLink, bracketLink
        };
        
        if (req.file) updateData.image = req.file.filename;

        let newMatches = [];
        if (req.body.matchStage) {
            let stages = Array.isArray(req.body.matchStage) ? req.body.matchStage : [req.body.matchStage];
            let titles = Array.isArray(req.body.matchTitle) ? req.body.matchTitle : [req.body.matchTitle];
            let roomIds = Array.isArray(req.body.matchRoomId) ? req.body.matchRoomId : [req.body.matchRoomId];
            for (let i = 0; i < stages.length; i++) {
                if (stages[i] && roomIds[i]) {
                    newMatches.push({ stage: stages[i].trim(), title: titles[i].trim(), roomId: roomIds[i].trim() });
                }
            }
        }
        updateData.matches = newMatches;
        await Tournament.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send('Error: ' + err.message); }
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
