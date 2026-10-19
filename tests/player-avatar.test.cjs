const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPlayerAvatar } = require('../public/player-avatar');

function image() {
    return { style: {}, dataset: {}, src: '', getAttribute(key) { return this[key]; }, removeAttribute(key) { delete this[key]; } };
}

test('occupied Discord seats show custom avatars and persist across state updates', () => {
    const img = image();
    const state = { taken: true, discordId: '123', avatar: 'hash' };
    renderPlayerAvatar(img, state);
    assert.equal(img.src, 'https://cdn.discordapp.com/avatars/123/hash.png');
    assert.equal(img.style.display, 'block');
    img.onerror();
    assert.equal(img.src, 'https://cdn.discordapp.com/embed/avatars/0.png');
    renderPlayerAvatar(img, state);
    assert.equal(img.src, 'https://cdn.discordapp.com/embed/avatars/0.png');
    img.onerror();
    assert.equal(img.src, '/logo.png');
    assert.equal(img.onerror, null);
});

test('Discord accounts without a custom avatar show the default avatar', () => {
    const img = image();
    renderPlayerAvatar(img, { taken: true, discordId: '123', avatar: null });
    assert.equal(img.style.display, 'block');
    assert.equal(img.src, 'https://cdn.discordapp.com/embed/avatars/0.png');
});

test('leaving or switching to a guest clears the previous Discord avatar', () => {
    const img = image();
    renderPlayerAvatar(img, { taken: true, discordId: '123', avatar: 'hash' });
    renderPlayerAvatar(img, { taken: false, discordId: '123', avatar: 'hash' });
    assert.equal(img.style.display, 'none');
    assert.equal(img.src, undefined);
    renderPlayerAvatar(img, { taken: true, discordId: '456', avatar: 'new-hash' });
    assert.equal(img.src, 'https://cdn.discordapp.com/avatars/456/new-hash.png');
    renderPlayerAvatar(img, { taken: true, discordId: null, avatar: null });
    assert.equal(img.style.display, 'none');
    assert.equal(img.src, undefined);
});
