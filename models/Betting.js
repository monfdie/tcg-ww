const mongoose = require('mongoose');
const { Schema } = mongoose;
const ref = { type: Schema.Types.ObjectId, ref: 'User', required: true };
const wallet = new Schema({ user: { ...ref, unique: true }, balance: { type: Number, required: true }, pending: { type: Number, default: 0 }, wealth: { type: Number, required: true }, week: String }, { timestamps: true });
wallet.index({ wealth: -1, user: 1 });
const event = new Schema({
    historyDeleted: { type: Boolean, default: false }, title: String, description: String, sides: [String], odds: [Number], closesAt: Date,
    status: { type: String, enum: ['draft', 'open', 'closed', 'settling', 'settled', 'cancelled'], default: 'draft' },
    version: { type: Number, default: 0 }, winner: Number, cancelled: { type: Boolean, default: false },
    createdBy: ref, decidedBy: { type: Schema.Types.ObjectId, ref: 'User' }, decidedAt: Date
}, { timestamps: true });
event.index({ status: 1, closesAt: 1 });
const bet = new Schema({ historyDeleted: { type: Boolean, default: false }, user: ref, event: { type: Schema.Types.ObjectId, ref: 'BettingEvent', required: true }, side: Number, amount: Number, odds: Number, payout: { type: Number, default: 0 }, status: { type: String, enum: ['pending', 'won', 'lost', 'refunded'], default: 'pending' }, request: { type: String, unique: true, required: true } }, { timestamps: true });
bet.index({ user: 1, createdAt: -1 });
bet.index({ event: 1, status: 1 });
const position = new Schema({ user: ref, event: { type: Schema.Types.ObjectId, required: true }, side: Number });
position.index({ user: 1, event: 1 }, { unique: true });
const ledger = new Schema({ user: ref, key: { type: String, unique: true, required: true }, amount: Number, kind: String, reason: String, actor: { type: Schema.Types.ObjectId, ref: 'User' } }, { timestamps: true });
ledger.index({ user: 1, createdAt: -1 });
const settings = new Schema({ _id: { type: String, default: 'main' }, starting: { type: Number, default: 1000 }, weekly: { type: Number, default: 250 } });
module.exports = {
    Wallet: mongoose.model('BettingWallet', wallet), Event: mongoose.model('BettingEvent', event),
    Bet: mongoose.model('BettingBet', bet), Position: mongoose.model('BettingPosition', position),
    Ledger: mongoose.model('BettingLedger', ledger), Settings: mongoose.model('BettingSettings', settings)
};
