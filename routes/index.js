const express = require('express');
const router = express.Router();
const passport = require('passport');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const CHARACTERS_BY_ELEMENT = require('../characters.json');

// Middleware для обработки данных формы (для админки)
const urlencodedParser = express.urlencoded({ extended: false });

router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

// --- ГЛАВНАЯ СТРАНИЦА (ДИНАМИЧЕСКАЯ) ---
router.get('/', async (req, res) => {
    try {
        const today = new Date();
        // Ищем турниры/новости, у которых дата скрытия еще не наступила или не задана
        const news = await Tournament.find({
            isLive: true,
            $or: [
                { visibleUntil: { $exists: false } },
                { visibleUntil: { $eq: null } },
                { visibleUntil: { $gt: today } }
            ]
        }).sort({ date: 1 }); // Сортируем: сначала ближайшие (или используйте _id: -1 для "сначала новые")

        res.render('pages/home', { title: 'Home', news });
    } catch (e) {
        console.error(e);
        res.render('pages/home', { title: 'Home', news: [] });
    }
});

router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Game' }));

// --- ТУРНИРЫ (СПИСОК) ---
// routes/index.js - Обновленный роут турниров

router.get('/tournaments', async (req, res) => {
    try {
        const currentDate = new Date();
        
        // 1. Ищем АКТИВНЫЕ (Live)
        const activeTournaments = await Tournament.find({ 
            isLive: true,
            $or: [
                { visibleUntil: { $exists: false } },
                { visibleUntil: { $eq: null } },
                { visibleUntil: { $gt: currentDate } }
            ]
        }).sort({ date: -1 }); // Сначала новые

        // 2. Ищем АРХИВ (Прошедшие или скрытые)
        const archivedTournaments = await Tournament.find({
            $or: [
                { isLive: false },
                { visibleUntil: { $lte: currentDate } }
            ]
        }).sort({ date: -1 });
        
        res.render('pages/tournaments', { 
            title: 'Tournaments', 
            tournaments: activeTournaments, 
            archive: archivedTournaments 
        });
    } catch (e) {
        console.error(e);
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: [], archive: [] });
    }
});

// --- СТРАНИЦА КОНКРЕТНОГО ТУРНИРА ---
router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');

        // Ищем матчи, привязанные к этому турниру
        const matches = await Match.find({ tournamentSlug: tour.slug }).sort({ date: -1 });

        res.render('pages/tournament_view', { 
            title: tour.title, 
            tour: tour,
            matches: matches // Передаем матчи в шаблон
        });
    } catch (e) {
        console.error(e);
        res.redirect('/tournaments');
    }
});

// --- АДМИНКА: ДОБАВЛЕНИЕ НОВОСТЕЙ/ТУРНИРОВ ---
router.get('/admin/secret-add', (req, res) => {
    // Здесь можно добавить проверку прав администратора, если нужно
    res.render('pages/admin_add', { title: 'Admin Add' });
});

router.post('/admin/add', urlencodedParser, async (req, res) => {
    try {
        const { slug, title, date, prize, region, system, regLink, cardStyle, badgeText, visibleUntil } = req.body;
        
        await Tournament.create({
            slug, title, date, prize, region, system, regLink,
            cardStyle, badgeText,
            visibleUntil: visibleUntil ? new Date(visibleUntil) : null,
            isLive: true
        });
        
        res.send(`
            <body style="background:#111; color:#fff; font-family:sans-serif; padding:50px;">
                <h1 style="color:#4facfe">Success!</h1> 
                <p>Tournament "<strong>${title}</strong>" added.</p> 
                <a href="/" style="color:#d4af37">Go Home</a> <br><br>
                <a href="/admin/secret-add" style="color:#888">Add Another</a>
            </body>
        `);
    } catch (e) {
        res.send(`Error: ${e.message}`);
    }
});

// --- ИСТОРИЯ (ТОЛЬКО СВОИ МАТЧИ) ---
router.get('/history', async (req, res) => {
    try {
        let matches = [];
        
        // Показываем историю только если пользователь вошел в систему
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
        console.error(e);
        res.render('pages/history', { title: 'History', matches: [] });
    }
});

// --- ИГРОВОЙ ПРОЦЕСС ---
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

// Просмотр завершенной игры из истории
router.get('/match/:roomId', async (req, res) => {
    try {
        const match = await Match.findOne({ roomId: req.params.roomId });
        if (!match) {
            return res.status(404).send('Match not found');
        }

        const charMap = {};
        for (const element in CHARACTERS_BY_ELEMENT) {
            CHARACTERS_BY_ELEMENT[element].forEach(c => {
                charMap[c.id] = c;
            });
        }

        // Рендерим страницу (можно использовать тот же game.ejs в режиме наблюдателя или отдельный шаблон)
        // Для простоты здесь перенаправляем на /game/:id, так как там есть логика savedData
        res.redirect(`/game/${match.roomId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// --- АВТОРИЗАЦИЯ ---
router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
router.get('/logout', (req, res, next) => {
    req.logout((err) => { if (err) return next(err); res.redirect('/'); });
});
// --- ADMIN DASHBOARD ---
router.get('/admin/dashboard', async (req, res) => {
    // Тут можно добавить проверку: if(req.user.role !== 'admin') return res.redirect('/');
    const tournaments = await Tournament.find().sort({ date: -1 });
    res.render('pages/admin_dashboard', { tournaments });
});

// Страница управления конкретным турниром
router.get('/admin/manage/:slug', async (req, res) => {
    const tour = await Tournament.findOne({ slug: req.params.slug });
    if(!tour) return res.send("Tournament not found");
    res.render('pages/admin_manage', { tour });
});

// Логика: Добавить объявление
router.post('/admin/announce', urlencodedParser, async (req, res) => {
    const { slug, title, content } = req.body;
    await Tournament.updateOne(
        { slug },
        { $push: { announcements: { title, content, date: new Date() } } }
    );
    res.redirect('/admin/manage/' + slug);
});

// Логика: Привязать матч
router.post('/admin/link-match', urlencodedParser, async (req, res) => {
    const { slug, roomId } = req.body;
    const match = await Match.findOne({ roomId: roomId.toUpperCase() });
    
    if (match) {
        match.tournamentSlug = slug;
        await match.save();
        res.redirect('/admin/manage/' + slug); // Успех
    } else {
        res.send(`Match ${roomId} not found! Check the ID.`);
    }
});
module.exports = router;
