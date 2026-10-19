const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const { integer, odds, payout, weekKey, isOpen } = require('../lib/betting-rules');

test('betting: exact fixed odds, integer validation and floor payouts', () => {
    assert.equal(odds('1.8'), 180);
    assert.equal(odds('1,99'), 199);
    assert.equal(payout(100, odds('1.8')), 180);
    assert.equal(payout(7, odds('1.99')), 13);
    assert.equal(payout(100, odds('1.13')), 113); // Floating-point multiplication can incorrectly floor to 112.
    for (const invalid of ['0.9', '1.234', '-2', 'Infinity', '1e3', '', {}, ['1.8']]) {
        assert.throws(() => odds(invalid));
    }
    for (const invalid of [0, -1, 1.2, '2e3', 'NaN', '9007199254740992']) assert.throws(() => integer(invalid));
    assert.throws(() => payout(Number.MAX_SAFE_INTEGER, 101));
});
test('betting: weekly bonus uses fixed UTC+3 Mondays without seasonal changes', () => {
    assert.equal(weekKey(new Date('2026-10-18T20:59:59Z')), '2026-10-12');
    assert.equal(weekKey(new Date('2026-10-18T21:00:00Z')), '2026-10-19');
    assert.equal(weekKey(new Date('2026-10-25T20:59:59Z')), '2026-10-19');
    assert.equal(weekKey(new Date('2026-10-25T21:00:00Z')), '2026-10-26');
    assert.equal(weekKey(new Date('2027-01-01T12:00:00Z')), '2026-12-28');
});
test('betting: deadline rejects bets at the exact boundary independently of worker', () => {
    const event = { status: 'open', closesAt: new Date('2026-10-18T12:00:00Z') };
    assert.equal(isOpen(event, new Date('2026-10-18T11:59:59.999Z')), true);
    assert.equal(isOpen(event, event.closesAt), false);
    assert.equal(isOpen({ status: 'closed', closesAt: null }), false);
    assert.equal(isOpen({ status: 'open', closesAt: null }), true);
});
test('betting: deadline editor round-trips fixed UTC+3 in winter and summer', () => {
    const vm = require('node:vm');
    const fs = require('node:fs');
    const script = fs.readFileSync(path.join(__dirname, '../public/betting.js'), 'utf8');
    for (const initial of ['2026-12-20T23:30:00.000Z', '2026-07-20T23:30:00.000Z']) {
        const input = { dataset: { initial }, value: '' };
        let submit;
        const form = { elements: { closesAt: { value: initial } }, querySelector: () => input, addEventListener: (_, fn) => { submit = fn; } };
        vm.runInNewContext(script, { document: { querySelectorAll: selector => selector === '[data-event-form]' ? [form] : [] } });
        assert.match(input.value, /21T02:30$/);
        submit();
        assert.equal(form.elements.closesAt.value, initial);
        input.value = '';
        submit();
        assert.equal(form.elements.closesAt.value, '');
    }
});
test('betting: all view modes render, escape event names, and preserve existing layout', async () => {
    const user = { _id: 'user1', discordId: '123', username: 'Игрок', avatar: null };
    const event = { _id: 'event1', title: '<script>bad()</script>', description: 'Описание', sides: ['А', 'Б'], odds: [180, 200], status: 'open', version: 2, closesAt: new Date(), winner: 0 };
    const bet = { _id: 'bet1', event, side: 0, amount: 100, odds: 180, status: 'pending', payout: 0, createdAt: new Date() };
    const base = { title: 'Ставки', path: '/bets', user, isAdmin: true, csrf: 'token', notice: null,
        wallet: { balance: 900, pending: 100, wealth: 1000, week: '2026-10-12' }, week: '2026-10-12',
        settings: { starting: 1000, weekly: 250 }, uuid: () => 'request', labels: {}, isOpen,
        oddsText: n => (n / 100).toFixed(2), dateText: String, events: [event], event, bets: [bet],
        page: 1, more: true, archive: false, creating: true, cancelled: false, winner: 0, total: 180,
        query: '', players: [], selected: null, stats: {}, removal: { balance: 900, amount: 100, reason: 'Test', token: 'test' }, deletion: {action: '/delete', title: 'Test', detail: 'Test', back: '/bets'}, count: 1, status: '', ledger: [], leaders: [{ user, rank: 1, wealth: 1000 }], ownRank: 1, message: 'Ошибка' };
    for (const mode of ['list', 'admin', 'points', 'participants', 'delete-confirm', 'event', 'edit', 'confirm', 'mine', 'leaders', 'error']) {
        const html = await ejs.renderFile(path.join(__dirname, '../views/pages/betting.ejs'), { ...base, mode });
        assert.match(html, /\/betting\.css/);
        assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
    }
    for (const mode of ['list', 'event', 'leaders', 'error']) {
        await ejs.renderFile(path.join(__dirname, '../views/pages/betting.ejs'), { ...base, mode, user: null, wallet: null, isAdmin: false });
    }
});
