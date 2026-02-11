const express = require('express');
const router = express.Router();
const passport = require('passport');
const Match = require('../models/Match');

// Мидлвар для передачи данных пользователя и пути во все шаблоны
router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

router.get('/', (req, res) => res.render('pages/home', { title: 'GITCG Draft - Home' }));
router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Draft' }));
router.get('/tournaments', (req, res) => res.render('pages/tournaments', { title: 'Tournaments' }));

// Роут истории
router.get('/history', async (req, res) => {
    try {
        const matches = await Match.find().sort({ date: -1 }).limit(20);
        res.render('pages/history', { title: 'Match History', matches: matches });
    } catch (err) {
        console.error("Ошибка загрузки истории:", err);
        res.render('pages/history', { title: 'Match History', matches: [] });
    }
});

// ИСПРАВЛЕННЫЙ РОУТ ИГРЫ
router.get('/game/:id', async (req, res) => {
    try {
        // Ищем матч в базе данных по roomId
        const savedMatch = await Match.findOne({ roomId: req.params.id });
        
        res.render('pages/game', { 
            title: `Room ${req.params.id}`, 
            roomId: req.params.id,
            // Передаем данные из базы, если они найдены, иначе null
            savedData: savedMatch || null 
        });
    } catch (err) {
        console.error("Ошибка поиска комнаты:", err);
        res.render('pages/game', { title: "Error", roomId: req.params.id, savedData: null });
    }
});

router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

module.exports = router;
