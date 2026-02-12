const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    roomId: String,
    draftType: String,
    blueName: String,
    redName: String,
    blueDiscordId: String,
    redDiscordId: String,
    bans: Array,
    bluePicks: Array,
    redPicks: Array,
    // Добавлено поле для результатов матчей
    results: { type: Array, default: [] }, 
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);
