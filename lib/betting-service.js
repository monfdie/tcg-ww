const mongoose = require('mongoose');
const { Wallet, Event, Bet, Position, Ledger, Settings } = require('../models/Betting');
const User = require('../models/User');
const rules = require('./betting-rules');
let initialization;
async function initialize() {
    if (!initialization) initialization = (async () => {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('Bets require MongoDB transactions (replica set or Atlas).');
        await Promise.all([Wallet, Event, Bet, Position, Ledger, Settings].map(m => m.init()));
        await Settings.updateOne({ _id: 'main' }, { $setOnInsert: { starting: 1000, weekly: 250 } }, { upsert: true });
    })().catch(error => { initialization = null; throw error; });
    return initialization;
}
async function transaction(fn) {
    await initialize();
    // Unique-key races (initial wallet/weekly claim/duplicate submission) retry from a fresh snapshot.
    for (let attempt = 0; attempt < 3; attempt++) {
        const session = await mongoose.startSession();
        try { return await session.withTransaction(() => fn(session)); }
        catch (error) { if (error.code !== 11000 || attempt === 2) throw error; }
        finally { await session.endSession(); }
    }
}
async function ensureWallet(user, session) {
    let wallet = await Wallet.findOne({ user }).session(session);
    if (!wallet) {
        const settings = await Settings.findById('main').session(session);
        [wallet] = await Wallet.create([{ user, balance: settings.starting, wealth: settings.starting }], { session });
        await Ledger.create([{ user, key: `start:${user}`, amount: settings.starting, kind: 'start', reason: 'Starting balance' }], { session });
    }
    return wallet;
}
async function walletFor(user) { return transaction(s => ensureWallet(user, s)); }
async function credit(user, amount, key, kind, reason, actor, session) {
    if (await Ledger.exists({ key }).session(session)) return;
    const wallet = await ensureWallet(user, session);
    if (!Number.isSafeInteger(wallet.wealth + amount)) throw new Error('Balance exceeds the supported range.');
    await Wallet.updateOne({ _id: wallet._id }, { $inc: { balance: amount, wealth: amount } }, { session });
    await Ledger.create([{ user, amount, key, kind, reason, actor }], { session });
}
async function claim(user) {
    return transaction(async session => {
        const wallet = await ensureWallet(user, session);
        const week = rules.weekKey();
        if (wallet.week === week) throw new Error('Weekly bonus already claimed.');
        const settings = await Settings.findById('main').session(session);
        await credit(user, settings.weekly, `week:${user}:${week}`, 'weekly', `Weekly bonus: ${week}`, null, session);
        await Wallet.updateOne({ user }, { $set: { week } }, { session });
    });
}
async function grant(user, amount, reason, actor, request) {
    rules.integer(amount);
    if (!reason || reason.trim().length < 3 || reason.length > 500) throw new Error('Enter a reason (3–500 characters).');
    return transaction(s => credit(user, amount, `grant:${actor}:${request}`, 'grant', reason.trim(), actor, s));
}
async function removePoints(user, amount, reason, actor, request, expectedBalance) {
    rules.integer(amount);
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) throw new Error('Enter a reason (3–500 characters).');
    return transaction(async session => {
        const key = `remove:${actor}:${request}`;
        if (await Ledger.exists({ key }).session(session)) return;
        const wallet = await ensureWallet(user, session);
        if (expectedBalance !== undefined && wallet.balance !== expectedBalance) throw new Error('Balance changed. Review the deduction again.');
        if (wallet.balance < amount) throw new Error('Insufficient available points. Points in pending bets cannot be removed.');
        await Wallet.updateOne({ _id: wallet._id, balance: { $gte: amount } }, { $inc: { balance: -amount, wealth: -amount } }, { session });
        await Ledger.create([{ user, amount: -amount, key, kind: 'remove', reason: reason.trim(), actor }], { session });
    });
}
async function place(user, eventId, side, amount, coefficient, request) {
    rules.integer(amount);
    if (![0, 1].includes(side)) throw new Error('Select a player.');
    return transaction(async session => {
        const key = `bet:${user}:${request}`;
        if (await Bet.exists({ request: key }).session(session)) return;
        const event = await Event.findById(eventId).session(session);
        if (!event || !rules.isOpen(event)) throw new Error('Betting is closed.');
        if (event.odds[side] !== coefficient) throw new Error('Odds have changed. Review the new odds and place your bet again.');
        rules.payout(amount, coefficient);
        // Every accepted bet writes the event: closing/changing odds and betting cannot race.
        const locked = await Event.updateOne({ _id: eventId, status: 'open', version: event.version, $or: [{ closesAt: null }, { closesAt: { $gt: new Date() } }] }, { $inc: { version: 1 } }, { session });
        if (!locked.modifiedCount) throw new Error('Betting is closed.');
        const position = await Position.findOne({ user, event: eventId }).session(session);
        if (position && position.side !== side) throw new Error('You can only bet on your previously selected side.');
        if (!position) await Position.create([{ user, event: eventId, side }], { session });
        const wallet = await ensureWallet(user, session);
        if (wallet.balance < amount) throw new Error('Insufficient points.');
        await Wallet.updateOne({ _id: wallet._id, balance: { $gte: amount } }, { $inc: { balance: -amount, pending: amount } }, { session });
        await Bet.create([{ user, event: eventId, side, amount, odds: coefficient, request: key }], { session });
        await Ledger.create([{ user, key, amount: -amount, kind: 'bet', reason: event.title }], { session });
    });
}
async function decide(eventId, winner, cancelled, actor, version) {
    if (!cancelled && ![0, 1].includes(winner)) throw new Error('Select the winner.');
    return transaction(async session => {
        const event = await Event.findById(eventId).session(session);
        if (!event || event.version !== version) throw new Error('Event changed. Open the confirmation again.');
        if (['settling', 'settled', 'cancelled'].includes(event.status)) throw new Error('Result already confirmed.');
        if (!cancelled && event.status !== 'closed') throw new Error('Close betting first.');
        await Event.updateOne({ _id: eventId, version }, { $set: { status: 'settling', winner: cancelled ? null : winner, cancelled, decidedBy: actor, decidedAt: new Date() }, $inc: { version: 1 } }, { session });
    });
}
async function settleOne(id) {
    return transaction(async session => {
        const bet = await Bet.findOne({ _id: id, status: 'pending' }).session(session);
        if (!bet) return;
        const event = await Event.findById(bet.event).session(session);
        if (event.status !== 'settling') return;
        const amount = event.cancelled ? bet.amount : event.winner === bet.side ? rules.payout(bet.amount, bet.odds) : 0;
        const status = event.cancelled ? 'refunded' : event.winner === bet.side ? 'won' : 'lost';
        const wallet = await Wallet.findOne({ user: bet.user }).session(session);
        if (!wallet || !Number.isSafeInteger(wallet.wealth - bet.amount + amount)) throw new Error('Unable to process payout. Check the wallet.');
        await Wallet.updateOne({ _id: wallet._id }, { $inc: { balance: amount, pending: -bet.amount, wealth: amount - bet.amount } }, { session });
        await Bet.updateOne({ _id: id, status: 'pending' }, { $set: { payout: amount, status } }, { session });
        await Ledger.create([{ user: bet.user, key: `settle:${id}`, amount, kind: status, reason: event.title }], { session });
    });
}
let running = false;
async function maintenance() {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try {
        await initialize();
        await Event.updateMany({ status: 'open', closesAt: { $lte: new Date() } }, { $set: { status: 'closed' }, $inc: { version: 1 } });
        const events = await Event.find({ status: 'settling' }).select('_id').lean();
        for (const event of events) {
            const bets = await Bet.find({ event: event._id, status: 'pending' }).limit(200).select('_id').lean();
            for (const bet of bets) await settleOne(bet._id);
            if (!await Bet.exists({ event: event._id, status: 'pending' })) {
                await Event.updateOne({ _id: event._id, status: 'settling' }, [{ $set: { status: { $cond: ['$cancelled', 'cancelled', 'settled'] } } }]);
            }
        }
        // Enrol existing and newly registered accounts without changing Discord login or draft flows.
        const missing = await User.aggregate([
            { $lookup: { from: Wallet.collection.name, localField: '_id', foreignField: 'user', as: 'wallet' } },
            { $match: { 'wallet.0': { $exists: false } } }, { $limit: 20 }, { $project: { _id: 1 } }
        ]);
        for (const user of missing) await walletFor(user._id);
    } finally { running = false; }
}
module.exports = { initialize, transaction, walletFor, claim, grant, removePoints, place, decide, maintenance, settleOne };
