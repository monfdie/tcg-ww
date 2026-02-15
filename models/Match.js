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
    immunityPool: Array,
    immunityBans: Array,

    // Привязка к турниру (например: 'gitcg-cup-2')
    // Если null — значит матч обычный (ладдерный/товарищеский)
    tournamentSlug: { type: String, default: null },

    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);
