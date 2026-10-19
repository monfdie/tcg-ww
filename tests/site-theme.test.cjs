const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');

test('shared visual theme is excluded from game rooms, including replay/error layouts', async () => {
    const header = path.join(__dirname, '../views/partials/header.ejs');
    for (const state of [{ path: '/game/ABCD', hideSidebar: true }, { path: '/game/ABCD' }, { path: '/', hideSidebar: true }]) {
        const html = await ejs.renderFile(header, state);
        assert.doesNotMatch(html, /site-theme\.css|class="modern-site"/);
        assert.match(html, /href="\/style\.css"/);
    }
    for (const page of ['/', '/create', '/tournaments', '/tierlist', '/history', '/bets/mine', '/admin/dashboard']) {
        const html = await ejs.renderFile(header, { path: page });
        assert.match(html, /site-theme\.css/);
        assert.match(html, /<body class="modern-site">/);
    }
});
