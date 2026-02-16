const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
    slug: { type: String, unique: true },
    title: String,
    date: String,
    prize: String,
    region: String,
    system: String,
    
    // Ссылки
    regLink: String,      // Регистрация
    rulesLinkRu: String,  // Регламент RU
    rulesLinkEn: String,  // Регламент EN
    
    // Внешний вид
    image: { type: String, default: null },
    type: { type: String, default: 'tournament' },
    description: { type: String, default: '' },
    openInModal: { type: Boolean, default: false },
    cardStyle: { type: String, default: 'blue' },
    badgeText: { type: String, default: 'OPEN' },
    
    // ЛЕНТА НОВОСТЕЙ (Как в Телеграме)
    announcements: [{
        text: String,
        image: String,
        date: { type: Date, default: Date.now }
    }],

    visibleUntil: { type: Date },
    isLive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
