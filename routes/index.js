const express = require('express');
const router = express.Router();
const passport = require('passport');
const Match = require('../models/Match');

router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

router.get('/', (req, res) => res.render('pages/home', { title: 'Home' }));
router.get('/create', (req, res) => res.render('pages/create', { title: 'Create' }));
router.get('/tournaments', (req, res) => res.render('pages/tournaments', { title: 'Tournaments' }));

router.get('/history', async (req, res) => {
    try {
        const matches = await Match.find().sort({ date: -1 }).limit(6);
        res.render('pages/history', { title: 'History', matches });
    } catch (e) {
        res.render('pages/history', { title: 'History', matches: [] });
    }
});

// --- ИЗМЕНЕННАЯ ЧАСТЬ НАЧАЛО ---
router.get('/game/:id', async (req, res) => {
    try {
        // Обязательно ищем матч в базе данных, чтобы история работала
        const match = await Match.findOne({ roomId: req.params.id });
        res.render('pages/game', { 
            title: `Room ${req.params.id}`, 
            roomId: req.params.id, 
            savedData: match || null,
            hideSidebar: true // <--- Добавлено: скрываем меню
        });
    } catch (e) {
        res.render('pages/game', { 
            title: "Error", 
            roomId: req.params.id, 
            savedData: null,
            hideSidebar: true // <--- Добавлено: скрываем меню даже при ошибке
        });
    }
});
// --- ИЗМЕНЕННАЯ ЧАСТЬ КОНЕЦ ---

router.get('/auth/discord', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
router.get('/logout', (req, res, next) => {
    req.logout((err) => { if (err) return next(err); res.redirect('/'); });
});

module.exports = router;
