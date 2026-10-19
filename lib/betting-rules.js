const MAX = Number.MAX_SAFE_INTEGER;
function integer(value, allowZero = false) {
    if (!['string', 'number'].includes(typeof value)) throw new Error('Enter a whole number of points.');
    if (!/^\d+$/.test(String(value))) throw new Error('Enter a whole number of points.');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1)) throw new Error('Invalid amount of points.');
    return n;
}
function odds(value) {
    if (!['string', 'number'].includes(typeof value)) throw new Error('Invalid odds.');
    const text = String(value).replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Odds must be at least 1 with up to two decimal places.');
    const [whole, fraction = ''] = text.split('.');
    const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (n < 100n || n > BigInt(MAX)) throw new Error('Invalid odds.');
    return Number(n);
}
function payout(amount, coefficient) {
    integer(amount); integer(coefficient);
    const result = BigInt(amount) * BigInt(coefficient) / 100n;
    if (result > BigInt(MAX)) throw new Error('Payout exceeds the supported range.');
    return Number(result);
}
function weekKey(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Etc/GMT-3', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = type => parts.find(p => p.type === type).value;
    const date = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
}
function isOpen(event, now = new Date()) {
    return event.status === 'open' && (!event.closesAt || new Date(event.closesAt) > now);
}
module.exports = { integer, odds, payout, weekKey, isOpen, MAX };
