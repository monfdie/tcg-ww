const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
    slug: { type: String, unique: true }, // Сделали необязательным (убрали required)
    title: String,
    date: String,
    prize: String,
    region: String,
    system: String,
    regLink: String,
    
    // Новые поля
    image: { type: String, default: null },
    type: { type: String, default: 'tournament' },
    
    description: { type: String, default: '' }, // Текст внутри окна
    openInModal: { type: Boolean, default: false }, // Если true — откроет окно
    
    cardStyle: { type: String, default: 'blue' },
    badgeText: { type: String, default: 'OPEN' },
    visibleUntil: { type: Date },
    isLive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
