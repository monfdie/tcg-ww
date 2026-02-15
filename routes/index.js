const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer'); // Для загрузки картинок
const path = require('path');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const CHARACTERS_BY_ELEMENT = require('../characters.json');

// --- НАСТРОЙКА ЗАГРУЗКИ КАРТИНОК (MULTER) ---
const storage = multer.diskStorage({
    destination: './public/uploads/', // Папка куда сохранять
    filename: function(req, file, cb){
        // Генерируем уникальное имя: post-ВРЕМЯ.png
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
        // Ищем активные посты (турниры и новости)
        const news = await Tournament.find({
            isLive: true,
            $or: [
                { visibleUntil: { $exists: false } },
                { visibleUntil: { $eq: null } },
                { visibleUntil: { $gt: today } }
            ]
        }).sort({ date: 1 }); // Сортировка: сначала ближайшие/новые

        res.render('pages/home', { title: 'Home', news });
    } catch (e) {
        console.error(e);
        res.render('pages/home', { title: 'Home', news: [] });
    }
});

// --- СТРАНИЦА СОЗДАНИЯ ИГРЫ ---
router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Game' }));

// --- СПИСОК ТУРНИРОВ ---
router.get('/tournaments', async (req, res) => {
    try {
        const currentDate = new Date();
        
        // 1. Активные турниры
        const activeTournaments = await Tournament.find({ 
            type: 'tournament', // Только турниры, новости тут не нужны
            isLive: true,
            $or: [
                { visibleUntil: { $exists: false } },
                { visibleUntil: { $eq: null } },
                { visibleUntil: { $gt: currentDate } }
            ]
        }).sort({ date: -1 });

        // 2. Архив
        const archivedTournaments = await Tournament.find({
            type: 'tournament',
            $or: [ { isLive: false }, { visibleUntil: { $lte: currentDate } } ]
        }).sort({ date: -1 });
        
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: activeTournaments, archive: archivedTournaments });
    } catch (e) {
        console.error(e);
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: [], archive: [] });
    }
});

// --- ПРОСМОТР КОНКРЕТНОГО ТУРНИРА ---
router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');

        const matches = await Match.find({ tournamentSlug: tour.slug }).sort({ date: -1 });

        res.render('pages/tournament_view', { 
            title: tour.title, 
            tour: tour, 
            matches: matches 
        });
    } catch (e) {
        res.redirect('/tournaments');
    }
});

// --- ИСТОРИЯ МАТЧЕЙ ---
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
//           АДМИН-ПАНЕЛЬ И ФУНКЦИИ
// ==========================================

// 1. Страница добавления (Форма)
router.get('/admin/secret-add', (req, res) => {
    // Тут можно добавить проверку: if (!req.user || req.user.role !== 'admin') return res.redirect('/');
    res.render('pages/admin_add', { title: 'Admin Add' });
});

// 2. ОБРАБОТЧИК СОЗДАНИЯ (POST) - Исправленный
router.post('/admin/add', upload.single('image'), async (req, res) => {
    try {
        // Извлекаем все поля, включая дублирующиеся имена (если есть) и новые (news...)
        const { 
            slug, title, date, prize, region, system, 
            cardStyle, badgeText, visibleUntil, type, openInModal,
            regLink, newsLink, 
            description, newsDescription 
        } = req.body;
        
        // --- 1. Генерация Slug (если пустой) ---
        let finalSlug = slug;
        if (!finalSlug || finalSlug.trim() === '') {
            finalSlug = 'post-' + Date.now(); // Уникальный ID из времени
        }

        // --- 2. Обработка картинки ---
        let imageFilename = null;
        if (req.file) {
            imageFilename = req.file.filename;
        }

        // --- 3. Выбор правильных данных (Турнир vs Новость) ---
        // Если это Новость - берем данные из полей news..., иначе из обычных
        // Это решает проблему с ошибкой массива ['','...']
        
        let finalDescription = (type === 'announcement') ? newsDescription : description;
        let finalRegLink = (type === 'announcement') ? newsLink : regLink;

        // ЗАЩИТА ОТ МАССИВОВ (Если вдруг HTML отправил дубликаты)
        if (Array.isArray(finalDescription)) {
            // Берем последнее непустое значение или просто последнее
            finalDescription = finalDescription.filter(s => s && s.trim() !== '').pop() || '';
        }
        if (Array.isArray(finalRegLink)) {
            finalRegLink = finalRegLink.filter(s => s && s.trim() !== '').pop() || '';
        }

        // --- 4. Создание записи в БД ---
        await Tournament.create({
            slug: finalSlug,
            title, date, prize, region, system, 
            cardStyle, badgeText, type,
            image: imageFilename,
            
            // Используем очищенные переменные
            regLink: finalRegLink,
            description: finalDescription,
            
            openInModal: openInModal === 'on',
            visibleUntil: visibleUntil ? new Date(visibleUntil) : null,
            isLive: true
        });
        
        res.send(`
            <body style="background:#111; color:#fff; font-family:sans-serif; padding:50px;">
                <h1 style="color:#4facfe">Success!</h1> 
                <p>Content "<strong>${title}</strong>" added successfully.</p> 
                <p style="color:#888; font-size:0.9em;">ID: ${finalSlug}</p>
                <br>
                <a href="/" style="color:#d4af37; text-decoration:none; border:1px solid #d4af37; padding:10px 20px; border-radius:5px;">Go Home</a>
                <a href="/admin/dashboard" style="color:#ff6b6b; margin-left:20px;">Manage All</a>
            </body>
        `);
    } catch (e) {
        console.error(e);
        res.send(`<h1 style="color:red">Error: ${e.message}</h1><p>Check console logs for details.</p>`);
    }
});

// 3. Панель управления (Dashboard)
router.get('/admin/dashboard', async (req, res) => {
    const tournaments = await Tournament.find().sort({ date: -1 });
    res.render('pages/admin_dashboard', { tournaments });
});

// 4. Удаление (POST)
router.post('/admin/delete/:id', async (req, res) => {
    try {
        await Tournament.findByIdAndDelete(req.params.id);
        res.redirect('/admin/dashboard');
    } catch (e) {
        res.send("Error deleting: " + e.message);
    }
});

// 5. Управление контентом турнира (Новости, Матчи)
router.get('/admin/manage/:slug', async (req, res) => {
    const tour = await Tournament.findOne({ slug: req.params.slug });
    if(!tour) return res.send("Tournament not found");
    res.render('pages/admin_manage', { tour });
});

router.post('/admin/announce', urlencodedParser, async (req, res) => {
    await Tournament.updateOne(
        { slug: req.body.slug },
        { $push: { announcements: { title: req.body.title, content: req.body.content, date: new Date() } } }
    );
    res.redirect('/admin/manage/' + req.body.slug);
});

router.post('/admin/link-match', urlencodedParser, async (req, res) => {
    const match = await Match.findOne({ roomId: req.body.roomId.toUpperCase() });
    if (match) { 
        match.tournamentSlug = req.body.slug; 
        await match.save(); 
        res.redirect('/admin/manage/' + req.body.slug); 
    } else { 
        res.send(`Match not found!`); 
    }
});

// --- ИГРОВЫЕ РОУТЫ ---
router.get('/game/:id', async (req, res) => {
    try {
        const match = await Match.findOne({ roomId: req.params.id });
        res.render('pages/game', { 
            title: `Room ${req.params.id}`, roomId: req.params.id, 
            savedData: match || null, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true 
        });
    } catch (e) {
        res.render('pages/game', { title: "Error", roomId: req.params.id, savedData: null, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true });
    }
});

// --- AUTH ---
router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
router.get('/logout', (req, res, next) => {
    req.logout((err) => { if (err) return next(err); res.redirect('/'); });
});

module.exports = router;
