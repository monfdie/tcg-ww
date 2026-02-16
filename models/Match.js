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
    
    // Игровые данные
    bans: Array,
    bluePicks: Array,
    redPicks: Array,
    
    // НОВОЕ: Расстановка по декам (массивы из 9 слотов)
    blueDecks: { type: Array, default: [] }, 
    redDecks: { type: Array, default: [] },

    immunityPool: Array,
    immunityBans: Array,

    tournamentSlug: { type: String, default: null },
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);
