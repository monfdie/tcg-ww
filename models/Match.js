const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    roomId: String,
    draftType: String,
    blueName: String,
    redName: String,
    blueDiscordId: String,
    redDiscordId: String,
    blueAvatar: String,
    redAvatar: String,
    
    // Драфт
    bans: Array,
    bluePicks: Array,
    redPicks: Array,
    immunityPool: Array,
    immunityBans: Array,

    // НОВОЕ: Деки и Результаты
    blueDecks: { type: Array, default: [] }, 
    redDecks: { type: Array, default: [] },
    
    // Массив победителей по играм: ['blue', 'red', 'blue']
    gameResults: { type: Array, default: [null, null, null] },
    
    // Итоговый счет
    score: { 
        blue: { type: Number, default: 0 }, 
        red: { type: Number, default: 0 } 
    },

    tournamentSlug: { type: String, default: null },
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);
