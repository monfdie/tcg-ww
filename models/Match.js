const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    roomId: String,
    draftType: { type: String, default: 'moba_3phase' },
    blueName: { type: String, default: 'Player 1' },
    redName: { type: String, default: 'Player 2' },
    blueDiscordId: String,
    redDiscordId: String,
    blueAvatar: String,
    redAvatar: String,
    
    // Структура драфта
    firstPick: { type: String, default: 'blue' }, // 'blue' или 'red'
    bans: { type: Array, default: [] },           // [{ id: String, team: String, phase: Number }]
    bluePicks: { type: Array, default: [] },
    redPicks: { type: Array, default: [] },
    
    // Резервное время (тайм-банк в секундах)
    blueReserve: { type: Number, default: 130 },
    redReserve: { type: Number, default: 130 },

    // Совместимость с прошлыми режимами
    immunityPool: { type: Array, default: [] },
    immunityBans: { type: Array, default: [] },
    blueDecks: { type: Array, default: [] }, 
    redDecks: { type: Array, default: [] },
    gameResults: { type: Array, default: [null, null, null] },
    score: { 
        blue: { type: Number, default: 0 }, 
        red: { type: Number, default: 0 } 
    },

    tournamentSlug: { type: String, default: null },
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);
