const mongoose = require('mongoose');

const boxSchema = new mongoose.Schema({
    name: { type: String, default: 'My Box' },
    characters: { type: [String], default: [] }
});

const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: String,
    avatar: String,
    role: { type: String, default: 'player' },
    gamesPlayed: { type: Number, default: 0 },
    dateRegistered: { type: Date, default: Date.now },
    box: { type: [String], default: [] }, // Старое поле для совместимости
    boxes: { type: [boxSchema], default: [{ name: 'Box 1', characters: [] }] }, // Новое поле для нескольких боксов
    activeBoxIndex: { type: Number, default: 0 } // Какой бокс выбран активным
});

module.exports = mongoose.model('User', userSchema);
