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
    destination: function (req, file, cb) { 
        cb(null, uploadDir); 
    },
    filename: function(req, file, cb) { 
        cb(null, 'post-' + Date.now() + path.extname(file.originalname)); 
    }
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
            $or: [ 
                { visibleUntil: { $exists: false } }, 
                { visibleUntil: { $eq: null } }, 
                { visibleUntil: { $gt: today } } 
            ]
        }).sort({ date: 1 });
        res.render('pages/home', { title: 'Home', news });
    } catch (e) {
        res.render('pages/home', { title: 'Home', news: [] });
    }
});

router.get('/create', (req, res) => {
    res.render('pages/create', { title: 'Create Game' });
});

router.get('/tournaments', async (req, res) => {
    try {
        const currentDate = new Date();
        const activeTournaments = await Tournament.find({ 
            type: 'tournament', 
            isLive: true,
            $or: [ 
                { visibleUntil: { $exists: false } }, 
                { visibleUntil: { $eq: null } }, 
                { visibleUntil: { $gt: currentDate } } 
            ]
        }).sort({ date: -1 });

        const archivedTournaments = await Tournament.find({
            type: 'tournament',
            $or: [ 
                { isLive: false }, 
                { visibleUntil: { $lte: currentDate } } 
            ]
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
            matches = await Match.find({ 
                $or: [ 
                    { blueDiscordId: req.user.discordId }, 
                    { redDiscordId: req.user.discordId } 
                ] 
            }).sort({ date: -1 });
        }
        res.render('pages/history', { title: 'My History', matches });
    } catch (e) {
        res.render('pages/history', { title: 'History', matches: [] });
    }
});

// ==========================================
//           АДМИН-ПАНЕЛЬ
// ==========================================

router.get('/admin/dashboard', async (req, res) => {
    const tournaments = await Tournament.find().sort({ date: -1 });
    res.render('pages/admin_dashboard', { tournaments });
});

// --- 1. ДОБАВЛЕНИЕ ТУРНИРА ---
router.get('/admin/add-tournament', (req, res) => {
    res.render('pages/admin_add_tournament', { title: 'Add Tournament' });
});

router.post('/admin/add-tournament', upload.single('image'), async (req, res) => {
    try {
        const { title, slug, date, prize, isMine, region, format, description, regLink, rulesLink, rulesEnLink, discordLink, telegramLink, bracketLink } = req.body;
        const image = req.file ? req.file.filename : '';
        
        await Tournament.create({ 
            type: 'tournament',
            title, slug, date, prize, image,
            isMine: isMine === 'on',
            region, format, description,
            regLink, rulesLink, rulesEnLink, discordLink, telegramLink, bracketLink,
            isLive: true
        });
        res.redirect('/admin/dashboard');
    } catch (err) { console.error(err); res.status(500).send('Error'); }
});

// --- 2. ДОБАВЛЕНИЕ ОБЪЯВЛЕНИЯ (НОВОСТИ) ---
router.get('/admin/add-announcement', (req, res) => {
    res.render('pages/admin_add_announcement', { title: 'Add Announcement' });
});

router.post('/admin/add-announcement', upload.single('image'), async (req, res) => {
    try {
        const { title, description, slug, regLink } = req.body;
        let finalSlug = slug && slug.trim() !== '' ? slug : 'news-' + Date.now();
        let imageFilename = req.file ? req.file.filename : null;

        await Tournament.create({
            type: 'announcement', 
            slug: finalSlug, 
            title: title, 
            image: imageFilename,
            description: description, 
            regLink: regLink, 
            isLive: true, 
            date: new Date().toLocaleDateString()
        });
        
        res.redirect('/admin/dashboard');
    } catch (e) { 
        res.send(`Error: ${e.message}`); 
    }
});

// --- 3. УДАЛЕНИЕ И РЕДАКТИРОВАНИЕ ---
router.post('/admin/delete/:id', async (req, res) => {
    try { 
        await Tournament.findByIdAndDelete(req.params.id); 
        res.redirect('/admin/dashboard'); 
    } catch (e) { 
        res.send("Error: " + e.message); 
    }
});

router.get('/admin/manage/:slug', async (req, res) => {
    const tour = await Tournament.findOne({ slug: req.params.slug });
    if(!tour) return res.send("Tournament not found");
    res.render('pages/admin_manage', { tour: tour });
});

router.post('/admin/edit/:id', upload.single('image'), async (req, res) => {
    try {
        const { title, slug, date, prize, isMine, region, format, description, regLink, rulesLink, rulesEnLink, discordLink, telegramLink, bracketLink } = req.body;
        const updateData = { 
            title, slug, date, prize,
            isMine: isMine === 'on',
            region, format, description,
            regLink, rulesLink, rulesEnLink, discordLink, telegramLink, bracketLink
        };
        if (req.file) updateData.image = req.file.filename;

        // Обработка ручного добавления матчей
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
    } catch (err) { console.error(err); res.status(500).send('Error'); }
});



// ==========================================
//           ИГРА И АВТОРИЗАЦИЯ
// ==========================================

router.get('/game/:id', async (req, res) => {
    try {
        const match = await Match.findOne({ roomId: req.params.id });
        res.render('pages/game', { 
            title: `Room ${req.params.id}`, 
            roomId: req.params.id, 
            savedData: match || null, 
            chars: CHARACTERS_BY_ELEMENT, 
            hideSidebar: true 
        });
    } catch (e) { 
        res.render('pages/game', { 
            title: "Error", 
            roomId: req.params.id, 
            savedData: null, 
            chars: CHARACTERS_BY_ELEMENT, 
            hideSidebar: true 
        }); 
    }
});

router.get('/auth/discord', passport.authenticate('discord'));

router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/');
});

router.get('/logout', (req, res, next) => { 
    req.logout((err) => { 
        if (err) return next(err); 
        res.redirect('/'); 
    }); 
});

module.exports = router;
