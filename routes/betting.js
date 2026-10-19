const express = require('express');
const { randomUUID, randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { Wallet, Event, Bet, Ledger, Settings } = require('../models/Betting');
const User = require('../models/User');
const service = require('../lib/betting-service');
const rules = require('../lib/betting-rules');
const router = express.Router();
const labels = { draft: 'Draft', open: 'Open', closed: 'Closed', settling: 'Settling', settled: 'Settled', cancelled: 'Cancelled', pending: 'Pending', won: 'Won', lost: 'Lost', refunded: 'Refunded' };
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const admin = (req, res, next) => res.locals.isAdmin ? next() : res.status(403).send('Admin access required.');
const auth = (req, res, next) => req.user ? next() : res.redirect('/auth/discord');
function text(value, max, required = true) {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error('Check the text fields.');
    return value.trim();
}
function requestId(value) {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Refresh the page and try again.');
    return value;
}
function eventData(body) {
    const closesAt = body.closesAt ? new Date(body.closesAt) : null;
    if (closesAt && !Number.isFinite(closesAt.getTime())) throw new Error('Invalid closing time.');
    const sides = [text(body.side0, 100), text(body.side1, 100)];
    if (sides[0] === sides[1]) throw new Error('Player names must be different.');
    return { title: text(body.title, 160), description: text(body.description || '', 3000, false), sides, odds: [rules.odds(body.odds0), rules.odds(body.odds1)], closesAt };
}
router.use(asyncRoute(async (req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.path = '/bets' + (req.path === '/' ? '' : req.path);
    res.locals.isAdmin = !!req.user && (req.user.discordId === process.env.ADMIN_DISCORD_ID || req.user.role === 'admin');
    req.session.bettingCsrf ||= randomBytes(32).toString('hex');
    res.locals.csrf = req.session.bettingCsrf;
    res.locals.notice = req.session.bettingNotice || null;
    delete req.session.bettingNotice;
    res.locals.labels = labels;
    res.locals.isOpen = rules.isOpen;
    res.locals.oddsText = n => (n / 100).toFixed(2);
    res.locals.dateText = date => date ? new Date(date).toLocaleString('en-GB', { timeZone: 'Etc/GMT-3', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Manual';
    res.locals.uuid = randomUUID;
    res.locals.wallet = null;
    res.locals.settings = { starting: 1000, weekly: 250 };
    res.locals.week = rules.weekKey();
    if (req.method === 'POST' && (!req.user || typeof req.body.csrf !== 'string' || req.body.csrf !== req.session.bettingCsrf)) return res.status(403).send('Form expired. Refresh the page.');
    await service.initialize();
    if (req.user) res.locals.wallet = await service.walletFor(req.user._id);
    res.locals.settings = await Settings.findById('main').lean();
    next();
}));
function render(res, mode, data = {}) { res.render('pages/betting', { title: 'Bets', mode, query: '', players: [], selected: null, stats: {}, ...data }); }
function redirect(req, res, path, message) { req.session.bettingNotice = message; res.redirect(303, path); }
router.get('/', asyncRoute(async (req, res) => {
    const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
    const filter = { historyDeleted: { $ne: true }, status: { $in: ['open', 'closed', 'settling'] } };
    const events = await Event.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(21).lean();
    render(res, 'list', { events: events.slice(0, 20), page, more: events.length > 20 });
}));
router.post('/bonus', auth, asyncRoute(async (req, res) => { await service.claim(req.user._id); redirect(req, res, '/bets', 'Weekly bonus claimed.'); }));
router.get('/mine', auth, asyncRoute(async (req, res) => {
    const status = ['pending', 'won', 'lost', 'refunded'].includes(req.query.status) ? req.query.status : '';
    const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
    const bets = await Bet.find({ user: req.user._id, historyDeleted: { $ne: true }, ...(status ? { status } : {}) }).populate('event').sort({ createdAt: -1 }).skip((page - 1) * 30).limit(31).lean();
    const ledger = await Ledger.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30).lean();
    render(res, 'mine', { bets: bets.slice(0, 30), more: bets.length > 30, page, status, ledger });
}));
router.get('/leaders', asyncRoute(async (req, res) => {
    const leaders = await Wallet.find({}).sort({ wealth: -1, user: 1 }).limit(10).populate('user', 'username avatar discordId').lean();
    let last = null, rank = 0;
    leaders.forEach((entry, i) => { if (entry.wealth !== last) rank = i + 1; entry.rank = rank; last = entry.wealth; });
    const own = res.locals.wallet;
    const ownRank = own ? 1 + await Wallet.countDocuments({ wealth: { $gt: own.wealth } }) : null;
    render(res, 'leaders', { leaders, ownRank });
}));
function pageNumber(value) { return Math.max(1, Math.min(100000, parseInt(value, 10) || 1)); }
async function eventStats(ids) {
    const groups = await Bet.aggregate([{ $match: { event: { $in: ids } } }, { $group: { _id: { event: '$event', side: '$side' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } }]);
    const stats = {};
    for (const row of groups) {
        const entry = stats[String(row._id.event)] ||= { count: 0, amount: 0, sides: [0, 0] };
        entry.count += row.count; entry.amount += row.amount; entry.sides[row._id.side] = row.amount;
    }
    return stats;
}
async function updateEvent(req, filter, changes, message) {
    const result = await Event.updateOne({ _id: req.params.id, ...filter }, changes);
    if (!result.matchedCount) throw new Error(message);
}
router.get('/admin/points', admin, asyncRoute(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const players = query ? await User.find({ $or: [{ username: { $regex: escaped, $options: 'i' } }, { discordId: query }] }).select('username avatar discordId').sort({ username: 1, _id: 1 }).limit(20).lean() : [];
    const selected = mongoose.isValidObjectId(req.query.player) ? await User.findById(req.query.player).select('username avatar discordId').lean() : null;
    const ids = [...players.map(player => player._id), ...(selected ? [selected._id] : [])];
    const wallets = await Wallet.find({ user: { $in: ids } }).select('user balance pending').lean();
    for (const player of [...players, ...(selected ? [selected] : [])]) {
        const wallet = wallets.find(wallet => String(wallet.user) === String(player._id));
        player.balance = wallet ? wallet.balance : res.locals.settings.starting;
        player.pending = wallet ? wallet.pending : 0;
    }
    render(res, 'points', { query, players, selected });
}));
router.get('/admin/event/:id/bets', admin, asyncRoute(async (req, res) => {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).send('Event not found.');
    const page = pageNumber(req.query.page);
    const bets = await Bet.find({ event: event._id }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 30).limit(31).populate('user', 'username discordId avatar').lean();
    render(res, 'participants', { event, bets: bets.slice(0, 30), page, more: bets.length > 30, stats: await eventStats([event._id]) });
}));
router.get('/admin', admin, asyncRoute(async (req, res) => {
    const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
    const events = await Event.find({ historyDeleted: { $ne: true } }).sort({ createdAt: -1 }).skip((page - 1) * 30).limit(31).lean();
    render(res, 'admin', { events: events.slice(0, 30), page, more: events.length > 30, stats: await eventStats(events.slice(0, 30).map(event => event._id)) });
}));
router.post('/admin/settings', admin, asyncRoute(async (req, res) => {
    const after = { starting: rules.integer(req.body.starting, true), weekly: rules.integer(req.body.weekly, true) };
    await Settings.updateOne({ _id: 'main' }, { $set: after });
    redirect(req, res, '/bets/admin/points', 'Settings saved.');
}));
router.post('/admin/grant', admin, asyncRoute(async (req, res) => {
    const user = await User.findOne({ discordId: text(req.body.discordId, 30) });
    if (!user) throw new Error('No user found with this Discord ID.');
    await service.grant(user._id, rules.integer(req.body.amount), req.body.reason, req.user._id, requestId(req.body.request));
    redirect(req, res, '/bets/admin/points?player=' + user._id, 'Points added.');
}));
router.post('/admin/remove/preview', admin, asyncRoute(async (req, res) => {
    const user = await User.findOne({ discordId: text(req.body.discordId, 30) }).lean();
    if (!user) throw new Error('Player not found.');
    const amount = rules.integer(req.body.amount);
    const reason = text(req.body.reason, 500);
    if (reason.length < 3) throw new Error('Enter a reason (3–500 characters).');
    const wallet = await service.walletFor(user._id);
    if (wallet.balance < amount) throw new Error('Insufficient available points.');
    const token = randomUUID();
    req.session.bettingRemoval = { token, user: String(user._id), amount, reason, balance: wallet.balance, expires: Date.now() + 10 * 60 * 1000 };
    render(res, 'remove-confirm', { selected: user, removal: req.session.bettingRemoval });
}));
router.post('/admin/remove', admin, asyncRoute(async (req, res) => {
    const removal = req.session.bettingRemoval;
    if (!removal || removal.token !== req.body.token || removal.expires < Date.now() || req.body.confirmed !== '1') throw new Error('Review and confirm the deduction again.');
    await service.removePoints(removal.user, removal.amount, removal.reason, req.user._id, removal.token, removal.balance);
    delete req.session.bettingRemoval;
    redirect(req, res, '/bets/admin/points?player=' + removal.user, 'Points removed.');
}));
router.get('/history/:id/delete-confirm', admin, asyncRoute(async (req, res) => {
    const bet = await Bet.findOne({ _id: req.params.id, user: req.user._id, status: { $ne: 'pending' } }).populate('event').lean();
    if (!bet) throw new Error('Completed bet not found.');
    render(res, 'delete-confirm', { deletion: { action: `/bets/history/${bet._id}/delete`, title: bet.event ? bet.event.title : 'Bet', detail: `Stake: ${bet.amount} · Payout: ${bet.payout}`, back: '/bets/mine' } });
}));
router.get('/event/:id/delete-confirm', admin, asyncRoute(async (req, res) => {
    const event = await Event.findOne({ _id: req.params.id, status: { $in: ['settled', 'cancelled'] } }).lean();
    if (!event) throw new Error('Completed event not found.');
    render(res, 'delete-confirm', { deletion: { action: `/bets/event/${event._id}/delete`, title: event.title, detail: event.sides.join(' vs '), back: '/bets/admin' } });
}));
router.post('/history/:id/delete', admin, asyncRoute(async (req, res) => {
    if (req.body.confirmed !== '1') throw new Error('Confirm deletion first.');
    const result = await Bet.updateOne({ _id: req.params.id, user: req.user._id, status: { $in: ['won', 'lost', 'refunded'] } }, { $set: { historyDeleted: true } });
    if (!result.matchedCount) throw new Error('Only your completed bets can be removed from history.');
    redirect(req, res, '/bets/mine', 'Completed bet removed from history.');
}));
router.post('/event/:id/delete', admin, asyncRoute(async (req, res) => {
    if (req.body.confirmed !== '1') throw new Error('Confirm deletion first.');
    await updateEvent(req, { historyDeleted: { $ne: true }, status: { $in: ['settled', 'cancelled'] } }, { $set: { historyDeleted: true } }, 'Only settled or cancelled events can be deleted from history.');
    redirect(req, res, '/bets/admin', 'Event removed from history.');
}));
router.post('/admin/create', admin, asyncRoute(async (req, res) => {
    // Client-generated ObjectId makes repeated form submission idempotent.
    if (!mongoose.isValidObjectId(req.body.id)) throw new Error('Refresh the form.');
    const data = eventData(req.body);
    const event = await service.transaction(async session => {
        const existing = await Event.findById(req.body.id).session(session);
        if (existing) return existing;
        const [event] = await Event.create([{ _id: req.body.id, ...data, createdBy: req.user._id, status: 'draft' }], { session });
        return event;
    });
    redirect(req, res, `/bets/event/${event._id}`, 'Draft saved.');
}));
router.get('/new', admin, (req, res) => render(res, 'edit', { event: { _id: new mongoose.Types.ObjectId(), title: '', description: '', sides: ['', ''], odds: [180, 180], status: 'draft', version: 0 }, creating: true }));
router.param('id', (req, res, next, id) => mongoose.isValidObjectId(id) ? next() : res.status(404).send('Event not found.'));
router.get('/event/:id', asyncRoute(async (req, res) => {
    const event = await Event.findById(req.params.id).lean();
    if (!event || (event.status === 'draft' && !res.locals.isAdmin)) return res.status(404).send('Event not found.');
    const bets = req.user ? await Bet.find({ user: req.user._id, event: event._id }).sort({ createdAt: -1 }).lean() : [];
    render(res, 'event', { event, bets });
}));
router.post('/event/:id/bet', auth, asyncRoute(async (req, res) => {
    await service.place(req.user._id, req.params.id, Number(req.body.side), rules.integer(req.body.amount), rules.integer(req.body.odds), requestId(req.body.request));
    redirect(req, res, `/bets/event/${req.params.id}`, 'Bet placed.');
}));
router.get('/event/:id/edit', admin, asyncRoute(async (req, res) => {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).send('Event not found.');
    render(res, 'edit', { event, creating: false });
}));
router.post('/event/:id/edit', admin, asyncRoute(async (req, res) => {
    const data = eventData(req.body);
    const event = await Event.findById(req.params.id).lean();
    if (!event || !['draft', 'open'].includes(event.status) || (event.status === 'open' && !rules.isOpen(event))) throw new Error('Closed events cannot be edited.');
    // Published participant identities and description remain immutable, including before the first bet.
    const changes = event.status === 'draft' ? data : { odds: data.odds, closesAt: data.closesAt };
    await updateEvent(req, { status: event.status, version: rules.integer(req.body.version, true), ...(event.status === 'open' ? { $or: [{ closesAt: null }, { closesAt: { $gt: new Date() } }] } : {}) }, { $set: changes, $inc: { version: 1 } }, 'Event changed. Refresh the page.');
    redirect(req, res, `/bets/event/${event._id}`, 'Changes saved.');
}));
router.post('/event/:id/publish', admin, asyncRoute(async (req, res) => {
    await updateEvent(req, { status: 'draft', version: rules.integer(req.body.version, true), $or: [{ closesAt: null }, { closesAt: { $gt: new Date() } }] }, { $set: { status: 'open' }, $inc: { version: 1 } }, 'Cannot publish. Check the status and closing time.');
    redirect(req, res, `/bets/event/${req.params.id}`, 'Betting is open.');
}));
router.post('/event/:id/close', admin, asyncRoute(async (req, res) => {
    await updateEvent(req, { status: 'open' }, { $set: { status: 'closed' }, $inc: { version: 1 } }, 'Event is no longer open.');
    redirect(req, res, `/bets/event/${req.params.id}`, 'Betting is closed.');
}));
router.get('/event/:id/confirm', admin, asyncRoute(async (req, res) => {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).send('Event not found.');
    const cancelled = req.query.cancel === '1';
    const winner = Number(req.query.winner);
    if (!cancelled && ![0, 1].includes(winner)) throw new Error('Select the winner.');
    const bets = await Bet.find({ event: event._id, status: 'pending' }).lean();
    const total = bets.reduce((sum, bet) => sum + BigInt(cancelled ? bet.amount : bet.side === winner ? rules.payout(bet.amount, bet.odds) : 0), 0n).toString();
    render(res, 'confirm', { event, cancelled, winner, total, count: bets.length });
}));
router.post('/event/:id/decide', admin, asyncRoute(async (req, res) => {
    await service.decide(req.params.id, Number(req.body.winner), req.body.cancelled === '1', req.user._id, rules.integer(req.body.version, true));
    service.maintenance().catch(error => console.error('Betting settlement:', error.message));
    redirect(req, res, `/bets/event/${req.params.id}`, 'Result confirmed. Processing payouts.');
}));
router.use((error, req, res, next) => {
    console.error('Betting:', error.message);
    const safe = error.name === 'Error' && !error.code;
    res.status(400);
    render(res, 'error', { message: safe ? error.message : 'Unable to complete the action. Refresh and try again.' });
});
module.exports = router;
