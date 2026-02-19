const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const CHARACTERS_BY_ELEMENT = require('../characters.json');

// --- 1. НАСТРОЙКА ПАПКИ ДЛЯ КАРТИНОК ---
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function(req, file, cb){ cb(null, 'post-' + Date.now() + path.extname(file.originalname)); }
});

const upload = multer({ storage: storage, limits: { fileSize: 5000000 } });
const urlencodedParser = express.urlencoded({ extended: false });

router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

// ==========================================
//           ПУБЛИЧНЫЕ СТРАНИЦЫ
// ==========================================

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

router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Game' }));

router.get('/tournaments', async (req, res) => {
    try {
        const currentDate = new Date();
        const activeTournaments = await Tournament.find({ 
            type: 'tournament', isLive: true,
            $or: [ { visibleUntil: { $exists: false } }, { visibleUntil: { $eq: null } }, { visibleUntil: { $gt: currentDate } } ]
        }).sort({ date: -1 });

        const archivedTournaments = await Tournament.find({
            type: 'tournament',
            $or: [ { isLive: false }, { visibleUntil: { $lte: currentDate } } ]
        }).sort({ date: -1 });
        
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: activeTournaments, archive: archivedTournaments });
    } catch (e) {
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: [], archive: [] });
    }
});

router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');
        const matches = await Match.find({ tournamentSlug: tour.slug }).sort({ date: -1 });
        res.render('pages/tournament_view', { title: tour.title, tour: tour, matches: matches });
    } catch (e) {
        res.redirect('/tournaments');
    }
});

router.get('/history', async (req, res) => {
    try {
        let matches = [];
        if (req.user) {
            matches = await Match.find({ $or: [ { blueDiscordId: req.user.discordId }, { redDiscordId: req.user.discordId } ] }).sort({ date: -1 });
        }
        res.render('pages/history', { title: 'My History', matches });
    } catch (e) {
        res.render('pages/history', { title: 'History', matches: [] });
    }
});

// ==========================================
//           АДМИН-ПАНЕЛЬ
// ==========================================

router.get('/admin/secret-add', (req, res) => res.render('pages/admin_add', { title: 'Admin Add' }));

router.get('/admin/dashboard', async (req, res) => {
    const tournaments = await Tournament.find().sort({ date: -1 });
    res.render('pages/admin_dashboard', { tournaments });
});

router.post('/admin/delete/:id', async (req, res) => {
    try { await Tournament.findByIdAndDelete(req.params.id); res.redirect('/admin/dashboard'); } catch (e) { res.send("Error: " + e.message); }
});

router.post('/admin/add', upload.single('image'), async (req, res) => {
    try {
        const { title, description, slug, regLink } = req.body;
        let finalSlug = slug;
        if (!finalSlug || finalSlug.trim() === '') finalSlug = 'news-' + Date.now();
        let imageFilename = null;
        if (req.file) imageFilename = req.file.filename;

        await Tournament.create({
            slug: finalSlug, title: title, type: 'announcement', image: imageFilename,
            description: description, regLink: regLink, isLive: true, date: new Date().toLocaleDateString()
        });
        res.send(`<body style="background:#111; color:#fff; text-align:center; padding:50px;"><h1 style="color:#d4af37">Post Published!</h1><br><a href="/admin/secret-add" style="color:#fff;">Create Another</a><br><br><a href="/" style="color:#4facfe">Go Home</a></body>`);
    } catch (e) { res.send(`Error: ${e.message}`); }
});

router.get('/admin/manage/:slug', async (req, res) => {
    const tour = await Tournament.findOne({ slug: req.params.slug });
    if(!tour) return res.send("Tournament not found");
    res.render('pages/admin_manage', { tour });
});

router.post('/admin/update-links', urlencodedParser, async (req, res) => {
    try {
        await Tournament.updateOne({ slug: req.body.slug }, { regLink: req.body.regLink, rulesLinkRu: req.body.rulesLinkRu, rulesLinkEn: req.body.rulesLinkEn });
        res.redirect('/admin/manage/' + req.body.slug);
    } catch(e) { res.send(e.message); }
});

router.post('/admin/announce', upload.single('image'), async (req, res) => {
    try {
        let filename = null; if (req.file) filename = req.file.filename;
        await Tournament.updateOne({ slug: req.body.slug }, { $push: { announcements: { text: req.body.text, image: filename, date: new Date() } } });
        res.redirect('/admin/manage/' + req.body.slug);
    } catch (e) { res.send(e.message); }
});

router.post('/admin/link-match', urlencodedParser, async (req, res) => {
    const match = await Match.findOne({ roomId: req.body.roomId.toUpperCase() });
    if (match) { match.tournamentSlug = req.body.slug; await match.save(); res.redirect('/admin/manage/' + req.body.slug); } else { res.send(`Match not found!`); }
});

// --- СЕКРЕТНЫЙ РОУТ ДЛЯ СОЗДАНИЯ ТУРНИРА LUNA ---
router.get('/admin/create-luna', async (req, res) => {
    try {
        let tour = await Tournament.findOne({ slug: 'luna-iv' });
        if (!tour) {
