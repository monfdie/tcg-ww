const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer'); // Подключаем загрузчик
const path = require('path');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const CHARACTERS_BY_ELEMENT = require('../characters.json');

// --- НАСТРОЙКА ЗАГРУЗКИ КАРТИНОК (MULTER) ---
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function(req, file, cb){
        // Генерируем уникальное имя файла
        cb(null, 'post-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5000000 } // Лимит 5MB
});

// Middleware для обработки обычных форм
const urlencodedParser = express.urlencoded({ extended: false });

router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

// --- ГЛАВНАЯ СТРАНИЦА ---
router.get('/', async (req, res) => {
    try {
        const today = new Date();
        const news = await Tournament.find({
            isLive: true,
            $or: [
                { visibleUntil: { $exists: false } },
                { visibleUntil: { $eq: null } },
                { visibleUntil: { $gt: today } }
            ]
        }).sort({ date: 1 }); // Сначала ближайшие события

        res.render('pages/home', { title: 'Home', news });
    } catch (e) {
        console.error(e);
        res.render('pages/home', { title: 'Home', news: [] });
    }
});

// --- АДМИНКА: ДОБАВЛЕНИЕ (С ФОТО) ---
router.get('/admin/secret-add', (req, res) => {
    res.render('pages/admin_add');
});

// ОБРАБОТЧИК ДОБАВЛЕНИЯ (Теперь с upload.single('image'))
router.post('/admin/add', upload.single('image'), async (req, res) => {
    try {
        const { slug, title, date, prize, region, system, regLink, cardStyle, badgeText, visibleUntil, type } = req.body;
        
        let imageFilename = null;
        if (req.file) {
            imageFilename = req.file.filename; // Сохраняем имя файла если он загружен
        }

        await Tournament.create({
            slug, title, date, prize, region, system, regLink,
            cardStyle, badgeText, type,
            image: imageFilename,
            visibleUntil: visibleUntil ? new Date(visibleUntil) : null,
            isLive: true
        });
        
        res.send(`
            <body style="background:#111; color:#fff; padding:50px; font-family:sans-serif;">
                <h1 style="color:#4facfe">Success!</h1> 
                <p>Post added successfully.</p> 
                <a href="/" style="color:#d4af37">Go Home</a> | 
                <a href="/admin/dashboard" style="color:#ff6b6b">Manage All</a>
            </body>
        `);
    } catch (e) {
        res.send(`Error: ${e.message}`);
    }
});

// --- АДМИНКА: УПРАВЛЕНИЕ И УДАЛЕНИЕ ---
router.get('/admin/dashboard', async (req, res) => {
    // Показываем всё (и старое, и новое) для управления
    const tournaments = await Tournament.find().sort({ date: -1 });
    res.render('pages/admin_dashboard', { tournaments });
});

// РОУТ УДАЛЕНИЯ
router.post('/admin/delete/:id', async (req, res) => {
    try {
        await Tournament.findByIdAndDelete(req.params.id);
        res.redirect('/admin/dashboard');
    } catch (e) {
        res.send("Error deleting: " + e.message);
    }
});

// --- ОСТАЛЬНЫЕ РОУТЫ (Турниры, История, Игры...) ---
router.get('/tournaments', async (req, res) => {
    try {
        const currentDate = new Date();
        const activeTournaments = await Tournament.find({ 
            type: 'tournament', // Показываем здесь ТОЛЬКО турниры
            isLive: true,
            $or: [
                { visibleUntil: { $exists: false } }, { visibleUntil: { $eq: null } }, { visibleUntil: { $gt: currentDate } }
            ]
        }).sort({ date: -1 });

        const archivedTournaments = await Tournament.find({
            type: 'tournament',
            $or: [ { isLive: false }, { visibleUntil: { $lte: currentDate } } ]
        }).sort({ date: -1 });
        
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: activeTournaments, archive: archivedTournaments });
    } catch (e) { res.render('pages/tournaments', { title: 'Tournaments', tournaments: [], archive: [] }); }
});

router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Game' }));
router.get('/history', async (req, res) => {
    let matches = [];
    if (req.user) {
        matches = await Match.find({ $or: [{ blueDiscordId: req.user.discordId }, { redDiscordId: req.user.discordId }] }).sort({ date: -1 });
    }
    res.render('pages/history', { title: 'My History', matches });
});

router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');
        const matches = await Match.find({ tournamentSlug: tour.slug }).sort({ date: -1 });
        res.render('pages/tournament_view', { title: tour.title, tour, matches });
    } catch (e) { res.redirect('/tournaments'); }
});

router.get('/admin/manage/:slug', async (req, res) => {
    const tour = await Tournament.findOne({ slug: req.params.slug });
    if(!tour) return res.send("Tournament not found");
    res.render('pages/admin_manage', { tour });
});

router.post('/admin/announce', urlencodedParser, async (req, res) => {
    await Tournament.updateOne({ slug: req.body.slug }, { $push: { announcements: { title: req.body.title, content: req.body.content, date: new Date() } } });
    res.redirect('/admin/manage/' + req.body.slug);
});

router.post('/admin/link-match', urlencodedParser, async (req, res) => {
    const match = await Match.findOne({ roomId: req.body.roomId.toUpperCase() });
    if (match) { match.tournamentSlug = req.body.slug; await match.save(); res.redirect('/admin/manage/' + req.body.slug); } 
    else { res.send(`Match not found!`); }
});

// Game & Auth Routes
router.get('/game/:id', async (req, res) => {
    try {
        const match = await Match.findOne({ roomId: req.params.id });
        res.render('pages/game', { title: `Room ${req.params.id}`, roomId: req.params.id, savedData: match || null, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true });
    } catch (e) { res.render('pages/game', { title: "Error", roomId: req.params.id, savedData: null, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true }); }
});
router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
router.get('/logout', (req, res, next) => { req.logout((err) => { if (err) return next(err); res.redirect('/'); }); });

module.exports = router;
