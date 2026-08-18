const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    name: { type: String, default: '' },
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    // Массив из 4 колод. Каждая колода - массив строк (id персонажей)
    decks: { type: [[String]], default: [[], [], [], []] }
});

const groupSchema = new mongoose.Schema({
    name: { type: String, required: true },
    stage: { type: Number, default: 1 }, // 1 - Stage 1, 2 - Stage 2
    players: { 
        type: [playerSchema], 
        default: () => [{}, {}, {}, {}] // По умолчанию 4 пустых игрока
    }
});

const matchSchema = new mongoose.Schema({
    stage: String,
    title: String,
    roomId: String
});

const tournamentSchema = new mongoose.Schema({
    type: { type: String, enum: ['tournament', 'announcement'], required: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    date: String,
    prize: String,
    image: String,
    isMine: { type: Boolean, default: false },
    isLive: { type: Boolean, default: false },
    region: String,
    format: String,
    description: String,
    regLink: String,
    rulesLink: String,
    rulesEnLink: String,
    discordLink: String,
    telegramLink: String,
    bracketLink: String,
    matches: [matchSchema],
    groups: [groupSchema], // НАШИ НОВЫЕ ГРУППЫ
    visibleUntil: Date,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
