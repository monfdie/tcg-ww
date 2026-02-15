const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    roomId: String,
    draftType: String,
    blueName: String,
    redName: String,
    blueDiscordId: String,
    redDiscordId: String,
    blueAvatar: String, // <-- ДОБАВЛЕНО
    redAvatar: String,  // <-- ДОБАВЛЕНО
    bans: Array,
    bluePicks: Array,
    redPicks: Array,
    immunityPool: Array,
    immunityBans: Array,
    date: { type: Date, default: Date.now }
tournamentSlug: { type: String, default: null }, // Сюда будем писать id турнира (например 'gitcg-cup-2')
    
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);
