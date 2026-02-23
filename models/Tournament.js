const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true }, // СЛАГ ДОЛЖЕН БЫТЬ УНИКАЛЬНЫМ
    date: { type: String },
    prize: { type: String },
    
    // ВЕРНУЛИ ЭТИ ПОЛЯ (Они нужны для работы главной страницы и новостей)
    type: { type: String, default: 'tournament' }, 
    isLive: { type: Boolean, default: true },
    
    // Новые поля
    isMine: { type: Boolean, default: true },
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

    // Матчи
    matches: { type: Array, default: [] },
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
