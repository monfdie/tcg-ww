const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
    slug: { type: String, unique: true, required: true }, // Например: 'gitcg-cup-2' (для ссылки)
    title: String,
    date: String,     // Текстовое описание даты, например "Feb 25, 2026"
    prize: String,
    region: String,   // EU, NA, AS
    system: String,   // Draft, Allpick
    
    // Ссылки
    regLink: String,
    rulesLinkRu: String,
    rulesLinkEn: String,
    
    // Анонсы (массив объектов)
    announcements: [{
        title: String,
        content: String,
        date: { type: Date, default: Date.now }
    }],

    // Статус
    isLive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
