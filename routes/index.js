const express = require('express');
const router = express.Router();

// Главная (Main)
router.get('/', (req, res) => {
    res.render('pages/home', { title: 'GITCG Draft - Home', path: '/' });
});

// Создание драфта (Create Draft)
router.get('/create', (req, res) => {
    res.render('pages/create', { title: 'Create Draft', path: '/create' });
});

// Турниры
router.get('/tournaments', (req, res) => {
    res.render('pages/tournaments', { title: 'Tournaments', path: '/tournaments' });
});

// История
router.get('/history', (req, res) => {
    res.render('pages/history', { title: 'Match History', path: '/history' });
});

// Комната игры (Динамический роут)
router.get('/game/:id', (req, res) => {
    const roomId = req.params.id;
    // Передаем roomId в шаблон
    res.render('pages/game', { title: `Room ${roomId}`, path: '/game', roomId: roomId });
});

module.exports = router;
