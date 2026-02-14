const express = require('express');
const router = express.Router();
const passport = require('passport');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament'); // ДОБАВЛЕНО: Модель турниров
const CHARACTERS_BY_ELEMENT = require('../characters.json');

router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

router.get('/', (req, res) => res.render('pages/home', { title: 'Home' }));
router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Game' }));

// --- ТУРНИРНАЯ ЧАСТЬ (ВСТАВЛЕНО) ---

// 1. Страница списка турниров (берет из БД)
router.get('/tournaments', async (req, res) => {
    try {
        const tournaments = await Tournament.find({ isLive: true }).sort({ date: -1 });
        res.render('pages/tournaments', { title: 'Tournaments', tournaments });
    } catch (e) {
        console.error(e);
        res.render('pages/tournaments', { title: 'Tournaments', tournaments: [] });
    }
});

// 2. Страница конкретного турнира
router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');

        res.render('pages/tournament_view', { 
            title: tour.title, 
            tour: tour,
            matches: [] 
        });
    } catch (e) {
        console.error(e);
        res.redirect('/tournaments');
    }
});

// 3. Секретный роут для создания турнира (запустить 1 раз)
router.get('/admin/create-gitcg-cup-2', async (req, res) => {
    const exist = await Tournament.findOne({ slug: 'gitcg-cup-2' });
    if(exist) return res.send('Tournament already exists!');

    await Tournament.create({
        slug: 'gitcg-cup-2',
        title: 'GITCG CUP 2',
        date: 'Feb 25, 2026',
        prize: 'TBD',
        region: 'EU',
        system: 'Draft',
        regLink: '#', 
        rulesLinkRu: '#', 
        rulesLinkEn: '#', 
        announcements: [
            {
                title: 'Welcome to GITCG CUP 2!',
                content: 'Registration is open! / Регистрация открыта!',
                date: new Date()
            }
        ],
        isLive: true
    });
    res.send('Tournament GITCG CUP 2 created successfully!');
});

// --- КОНЕЦ ТУРНИРНОЙ ЧАСТИ ---


// Дальше твой код без изменений
router.get('/history', async (req, res) => {
    try {
        const matches = await Match.find().sort({ date: -1 }).limit(6);
        res.render('pages/history', { title: 'History', matches });
    } catch (e) {
        res.render('pages/history', { title: 'History', matches: [] });
    }
});

// Маршрут для активной игры
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

// НОВЫЙ маршрут для просмотра завершенной игры из истории
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

        res.render('pages/match', {
            title: `Match ${match.roomId}`,
            path: '/history', 
            user: req.user,
            match: match,
            charMap: charMap
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
router.get('/logout', (req, res, next) => {
    req.logout((err) => { if (err) return next(err); res.redirect('/'); });
});

module.exports = router;
