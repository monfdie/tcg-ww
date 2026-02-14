const mongoose = require('mongoose');

const gameSessionSchema = new mongoose.Schema({
    roomId: { type: String, unique: true },
    // Игроки
    bluePlayer: String, blueUserId: String, blueDiscordId: String, blueAvatar: String, blueName: String,
    redPlayer: String, redUserId: String, redDiscordId: String, redAvatar: String, redName: String,
    spectators: Array,
    // Настройки драфта
    draftType: String,
    draftOrder: Array,
    gameStarted: Boolean,
    // Иммунитет режим
    immunityPhaseActive: Boolean,
    immunityStepIndex: Number,
    immunityPool: Array,
    immunityBans: Array,
    // Состояние игры
    lastActive: Number,
    stepIndex: Number,
    currentTeam: String,
    currentAction: String,
    timer: Number,
    blueReserve: Number,
    redReserve: Number,
    bans: Array,
    bluePicks: Array,
    redPicks: Array,
    ready: Object // { blue: boolean, red: boolean }
});

module.exports = mongoose.model('GameSession', gameSessionSchema);
//sqnsqinsiq
