const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
    slug: { type: String, unique: true, required: true },
    title: String,
    date: String,
    prize: String,
    region: String,
    system: String,
    regLink: String,
    
    // Новые поля
    image: { type: String, default: null }, // Ссылка на картинку
    type: { type: String, default: 'tournament' }, // 'tournament' или 'announcement'
    
    cardStyle: { type: String, default: 'blue' },
    badgeText: { type: String, default: 'OPEN' },
    visibleUntil: { type: Date },
    isLive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
