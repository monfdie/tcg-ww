const express = require('express');
const router = express.Router();
const passport = require('passport');
const Match = require('../models/Match');
const CHARACTERS_BY_ELEMENT = require('../characters.json');

router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

router.get('/', (req, res) => res.render('pages/home', { title: 'Home' }));
router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Game' }));
router.get('/tournaments', (req, res) => res.render('pages/tournaments', { title: 'Tournaments' }));

router.get('/history', async (req, res) => {
    try {
        const matches = await Match.find().sort({ date: -1 }).limit(6);
        res.render('pages/history', { title: 'History', matches });
    } catch (e) {
        res.render('pages/history', { title: 'History', matches: [] });
    }
});

// Единый роут для Активной игры и для Повторов
router.get('/game/:id', async (req, res) => {
    try {
        const match = await Match.findOne({ roomId: req.params.id });
        res.render('pages/game', { 
            title: `Room ${req.params.id}`, 
            roomId: req.params.id, 
            savedData: match || null,
            chars: CHARACTERS_BY_ELEMENT, // <--- ДОБАВЛЕНО
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
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
router.get('/logout', (req, res, next) => {
    req.logout((err) => { if (err) return next(err); res.redirect('/'); });
});

module.exports = router;
