const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: String,
    avatar: String,
    role: { type: String, default: 'player' }, // Можно будет выдавать админки
    gamesPlayed: { type: Number, default: 0 },
    dateRegistered: { type: Date, default: Date.now },
    box: { type: [String], default: [] } // <--- Добавлено сохранение Бокса
});

module.exports = mongoose.model('User', userSchema);
