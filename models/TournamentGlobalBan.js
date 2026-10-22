const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    discordId: { type: String, required: true },
    characterIds: { type: [String], required: true },
    updatedAt: { type: Date, default: Date.now }
});

schema.index({ tournamentId: 1, discordId: 1 }, { unique: true });
module.exports = mongoose.model('TournamentGlobalBan', schema);
