const express = require('express');
const router = express.Router();
const passport = require('passport');

// Мидлвар, который передает данные юзера во все шаблоны
router.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = req.path;
    next();
});

// --- РОУТЫ СТРАНИЦ ---
router.get('/', (req, res) => res.render('pages/home', { title: 'GITCG Draft - Home' }));
router.get('/create', (req, res) => res.render('pages/create', { title: 'Create Draft' }));
router.get('/tournaments', (req, res) => res.render('pages/tournaments', { title: 'Tournaments' }));
router.get('/history', (req, res) => res.render('pages/history', { title: 'Match History' }));
router.get('/game/:id', (req, res) => res.render('pages/game', { title: `Room ${req.params.id}`, roomId: req.params.id }));

// --- РОУТЫ DISCORD АВТОРИЗАЦИИ ---
router.get('/auth/discord', passport.authenticate('discord'));

router.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => {
    // При успешном входе кидаем юзера на главную
    res.redirect('/'); 
});

router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

module.exports = router;
