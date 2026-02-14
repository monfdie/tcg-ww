const express = require('express');
const router = express.Router();
const passport = require('passport');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament'); // Подключаем новую модель
const CHARACTERS_BY_ELEMENT = require('../characters.json');

router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

router.get('/', (req, res) => res.render('pages/home', { title: 'Home' }));
router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Game' }));

// Страница списка турниров
router.get('/tournaments', async (req, res) => {
    // Получаем список турниров из БД
    const tournaments = await Tournament.find({ isLive: true }).sort({ date: -1 });
    res.render('pages/tournaments', { title: 'Tournaments', tournaments });
});

// Страница конкретного турнира (С ВКЛАДКАМИ)
router.get('/tournament/:slug', async (req, res) => {
    try {
        const tour = await Tournament.findOne({ slug: req.params.slug });
        if (!tour) return res.status(404).send('Tournament not found');

        // Здесь можно также найти матчи, связанные с этим турниром, если нужно
        // const matches = await Match.find({ draftType: 'gitcg_cup_2' }).limit(10); 
        
        res.render('pages/tournament_view', { 
            title: tour.title, 
            tour: tour,
            matches: [] // Пока пустой список матчей
        });
    } catch (e) {
        console.error(e);
        res.redirect('/tournaments');
    }
});

// --- СЕКРЕТНЫЙ РОУТ ДЛЯ СОЗДАНИЯ ТУРНИРА (ЗАПУСТИТЬ ОДИН РАЗ В БРАУЗЕРЕ) ---
router.get('/admin/create-gitcg-cup-2', async (req, res) => {
    // Проверка, что турнир уже есть, чтобы не дублировать
    const exist = await Tournament.findOne({ slug: 'gitcg-cup-2' });
    if(exist) return res.send('Tournament already exists!');

    await Tournament.create({
        slug: 'gitcg-cup-2',
        title: 'GITCG CUP 2',
        date: 'Feb 25, 2026',
        prize: 'TBD',
        region: 'EU',
        system: 'Draft',
        regLink: '#', // Замените на реальную ссылку
        rulesLinkRu: '#', // Замените на реальную ссылку
        rulesLinkEn: '#', // Замените на реальную ссылку
        announcements: [
            {
                title: 'Welcome to GITCG CUP 2!',
                content: 'Регистрация открыта! Ознакомьтесь с регламентом перед участием. / Registration is open! Please read the rules before participating.',
                date: new Date()
            }
        ],
        isLive: true
    });
    res.send('Tournament GITCG CUP 2 created successfully!');
});
// ---------------------------------------------------------------------------

router.get('/history', async (req, res) => {
    try {
        let query = {};
        if (req.user && req.user.discordId) {
            query = {
                $or: [
                    { blueDiscordId: req.user.discordId },
                    { redDiscordId: req.user.discordId }
                ]
            };
        } 
        const matches = await Match.find(query).sort({ date: -1 }).limit(20);
        res.render('pages/history', { title: 'History', matches });
    } catch (e) {
        res.render('pages/history', { title: 'History', matches: [] });
    }
});

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
        res.render('pages/game', { title: "Error", roomId: req.params.id, savedData: null, chars: CHARACTERS_BY_ELEMENT, hideSidebar: true });
    }
});

router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
router.get('/logout', (req, res, next) => {
    req.logout((err) => { if (err) return next(err); res.redirect('/'); });
});

module.exports = router;
