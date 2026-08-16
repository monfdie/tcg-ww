const mongoose = require('mongoose');

const playerGroupSchema = new mongoose.Schema({
    name: String,           // Имя игрока (например, "Maks")
    discordId: String,      // (Опционально) для привязки аватарок в будущем
    place: Number,          // Занятое место (1, 2, 3, 4)
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    // Колды: массив из 4 элементов. Каждый элемент - массив из 3 ID персонажей
    decks: { type: [[String]], default: [[], [], [], []] } 
});

const groupSchema = new mongoose.Schema({
    name: String,           // "Group A"
    players: [playerGroupSchema]
});

const tournamentSchema = new mongoose.Schema({
    type: { type: String, enum: ['tournament', 'announcement'], default: 'tournament' },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: String,
    date: String,
    prize: String,
    image: String,
    
    // Ссылки
    regLink: String,
    rulesLink: String,
    rulesEnLink: String,
    discordLink: String,
    telegramLink: String,
    bracketLink: String,
    
    isLive: { type: Boolean, default: true },
    isMine: { type: Boolean, default: true },
    region: String,
    format: String,

    visibleUntil: Date,
    createdAt: { type: Date, default: Date.now },

    matches: [{
        stage: String,
        title: String,
        roomId: String
    }],

    // НОВЫЕ ПОЛЯ ДЛЯ ГРУППОВОГО ЭТАПА
    groupStage1: [groupSchema],
    groupStage2: [groupSchema]
});

module.exports = mongoose.model('Tournament', tournamentSchema);
