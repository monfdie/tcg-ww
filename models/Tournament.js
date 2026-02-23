const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    date: { type: String },
    prize: { type: String },
    
    // Новые поля
    isMine: { type: Boolean, default: true }, // Твой или Чужой
    region: { type: String, default: 'Global' },
    format: { type: String, default: 'Standard' },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    
    // Ссылки
    regLink: { type: String, default: '' },
    rulesLink: { type: String, default: '' },
    rulesEnLink: { type: String, default: '' },
    discordLink: { type: String, default: '' },
    telegramLink: { type: String, default: '' },
    bracketLink: { type: String, default: '' },

    // Матчи (для твоих турниров)
    // Формат: [{ stage: "Final", title: "P1 vs P2", roomId: "ABCD" }]
    matches: { type: Array, default: [] },
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
