const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const session = require('express-session');
const { Passport } = require('passport');
const signature = require('cookie-signature');
const WebSocket = require('ws');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const projectRequire = createRequire(path.join(root, 'server.js'));
const { socketIdentity } = require('../lib/socket-identity');

// Real Express/session/Passport/Socket.IO, with only external persistence replaced.
function startApp({ store = new session.MemoryStore(), env = {} } = {}) {
    const passport = new Passport();
    const saved = [], statistics = [];
    const users = {
        alice: { id: 'alice', username: 'Alice', discordId: 'discord-alice', avatar: 'alice-avatar' },
        bob: { id: 'bob', username: 'Bob', discordId: 'discord-bob', avatar: 'bob-avatar' }
    };
    const User = {
        findById: async id => users[id] || null,
        updateOne: async (...args) => statistics.push(args)
    };
    const Match = {
        create: async data => saved.push(data),
        updateOne: async (query, update) => {
            const match = saved.find(m => m.roomId === query.roomId && m.gameNumber === query.gameNumber);
            if (match) Object.assign(match, update.$set);
        },
        countDocuments: async () => saved.length,
        findOne: async ({ roomId }) => saved.find(m => m.roomId === roomId) || null,
        find: () => ({ sort: () => ({ limit: async () => saved }) })
    };
    const globalTournament = { _id: 'global-test-id', slug: 'global-test', title: 'Global Test',
        type: 'tournament', isMine: true, isLive: true, globalBansEnabled: true, globalBansLocked: false, globalBanCount: 3 };
    const globalBanEntries = [
        { discordId: 'discord-alice', characterIds: ['ganyu', 'diona', 'kaeya'] },
        { discordId: 'discord-bob', characterIds: ['chongyun', 'ayaka', 'eula'] }
    ];
    const Tournament = {
        find: () => ({ select: () => ({ sort: () => ({ lean: async () => [globalTournament] }) }) }),
        findOne: async query => query.slug === globalTournament.slug ? globalTournament : null,
        findById: async id => id === globalTournament._id ? globalTournament : null
    };
    const TournamentGlobalBan = {
        find: () => ({ lean: async () => globalBanEntries }),
        updateOne: async (query, update) => {
            let entry = globalBanEntries.find(item => item.discordId === query.discordId);
            if (!entry) { entry = { discordId: query.discordId }; globalBanEntries.push(entry); }
            entry.characterIds = update.$set.characterIds;
        }
    };
    const timers = [];
    let router;
    function load(filename, suffix = '') {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8') + suffix, {
            require: name => {
                if (name === 'dotenv') return { config() {} };
                if (name === 'passport') return passport;
                if (name === 'mongoose') return { connect: async () => {} };
                if (name === 'connect-mongo') return { create: () => store };
                if (/models\/User$/.test(name)) return User;
                if (/models\/Match$/.test(name)) return Match;
                if (/models\/Tournament$/.test(name)) return Tournament;
                if (/models\/TournamentGlobalBan$/.test(name)) return TournamentGlobalBan;
                if (name === './routes/index') return router;
                if (name.startsWith('../')) return projectRequire('./' + name.slice(3));
                return projectRequire(name);
            },
            module, exports: module.exports,
            __dirname: path.dirname(path.join(root, filename)),
            process: { env: { PORT: '0', SESSION_SECRET: 'test-secret', DISCORD_CLIENT_ID: 'test', DISCORD_CLIENT_SECRET: 'test', ...env } },
            console: { log() {}, error() {} },
            setInterval: (...args) => { const timer = setInterval(...args); timers.push(timer); return timer; },
            clearInterval
        }, { filename });
        return module.exports;
    }
    router = load('routes/index.js');
    // Export test handles without changing the production entry point.
    const app = load('server.js', '\nmodule.exports = { server, io, sessions };');
    return { ...app, store, users, saved, statistics, timers, globalTournament, globalBanEntries };
}

class Client {
    constructor(url, cookie) {
        this.messages = [];
        this.waiters = [];
        this.ws = new WebSocket(url, { headers: cookie ? { Cookie: cookie } : {} });
        this.ws.on('message', data => {
            const packet = data.toString();
            if (packet === '2') return this.ws.send('3');
            if (packet.startsWith('0')) return this.ws.send('40');
            let event;
            if (packet.startsWith('40')) event = ['connected'];
            else if (packet.startsWith('44')) event = ['connect_error', JSON.parse(packet.slice(2))];
            else if (packet.startsWith('42')) event = JSON.parse(packet.slice(2));
            if (!event) return;
            const i = this.waiters.findIndex(w => w.name === event[0]);
            if (i >= 0) this.waiters.splice(i, 1)[0].resolve(event[1]);
            else this.messages.push(event);
        });
    }
    wait(name) {
        const i = this.messages.findIndex(e => e[0] === name);
        if (i >= 0) return Promise.resolve(this.messages.splice(i, 1)[0][1]);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 3000);
            this.waiters.push({ name, resolve: value => { clearTimeout(timer); resolve(value); } });
        });
    }
    emit(name, data) { this.ws.send('42' + JSON.stringify([name, data])); }
    close() { this.ws.terminate(); }
}

test('identity lookup fails closed for absent, deleted, or unavailable sessions', async () => {
    const run = async (session, User) => {
        const socket = { request: { session }, data: {} };
        const error = await new Promise(resolve => socketIdentity(User)(socket, resolve));
        assert(error instanceof Error);
        assert.equal(socket.data.identity, undefined);
    };
    await run(null, {});
    await run({}, {});
    await run({ passport: { user: 'missing' } }, { findById: async () => null });
    await run({ passport: { user: 'alice' } }, { findById: async () => { throw Error('offline'); } });
});

test('BO3 requires matching results and both ready votes, then swaps sides and ends at two wins', async () => {
    const app = startApp();
    const clients = [];
    try {
        if (!app.server.listening) await new Promise(resolve => app.server.once('listening', resolve));
        const origin = `http://127.0.0.1:${app.server.address().port}`;
        async function connect(account) {
            const response = await fetch(origin + '/create');
            const cookie = response.headers.get('set-cookie').split(';')[0];
            const sid = signature.unsign(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).slice(2), 'test-secret');
            const stored = await new Promise((resolve, reject) => app.store.get(sid, (err, value) => err ? reject(err) : resolve(value)));
            stored.passport = { user: account };
            await new Promise((resolve, reject) => app.store.set(sid, stored, err => err ? reject(err) : resolve()));
            const client = new Client(origin.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket', cookie);
            clients.push(client);
            await client.wait('connected');
            return client;
        }
        const alice = await connect('alice'), bob = await connect('bob');
        alice.emit('create_game', { draftType: 'classic', bestOf: 3 });
        const { roomId } = await alice.wait('init_game');
        alice.emit('take_seat', { roomId, side: 'blue' });
        await alice.wait('role_update');
        bob.emit('rejoin_game', { roomId });
        await bob.wait('init_game');
        bob.emit('take_seat', { roomId, side: 'red' });
        await bob.wait('role_update');
        const s = app.sessions[roomId];
        // A one-step draft exercises the real finish/result/advance socket flow.
        s.draftOrder = [{ team: 'blue', type: 'ban' }];
        s.gameStarted = true;
        s.currentTeam = 'blue';
        s.currentAction = 'ban';
        s.globalBans = { blue: ['ganyu'], red: ['ayaka'] };
        alice.emit('action', { roomId, charId: 'diona' });
        await alice.wait('game_over');
        assert.equal(s.games.length, 1);
        alice.emit('vote_result', { roomId, winner: 'blue' });
        bob.emit('vote_result', { roomId, winner: 'red' });
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(s.confirmedWinner, null);
        bob.emit('vote_result', { roomId, winner: 'blue' });
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(s.score.player1, 1);
        alice.emit('next_game_ready', { roomId });
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(s.gameNumber, 1);
        alice.emit('next_game_ready', { roomId });
        bob.emit('next_game_ready', { roomId });
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(s.gameNumber, 1);
        alice.emit('next_game_ready', { roomId });
        await alice.wait('series_game_changed');
        assert.equal(s.gameNumber, 2);
        assert.equal(s.blueName, 'Bob');
        assert.equal(s.redName, 'Alice');
        assert.deepEqual([...s.globalBans.blue], ['ayaka']);
        assert.deepEqual([...s.globalBans.red], ['ganyu']);
        assert.equal(s.bans.length, 0);
        assert.equal(s.ready.blue, false);
        assert.equal(app.saved.length, 1);
        assert.equal(s.games[0].blueName, 'Alice');
        assert.equal(s.games[0].globalBans.blue[0], 'ganyu');
        s.gameStarted = true;
        s.currentTeam = 'blue';
        s.currentAction = 'ban';
        bob.emit('action', { roomId, charId: 'kaeya' });
        await bob.wait('game_over');
        alice.emit('vote_result', { roomId, winner: 'red' });
        bob.emit('vote_result', { roomId, winner: 'red' });
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(s.score.player1, 2);
        assert.equal(s.seriesFinished, true);
        bob.emit('next_game_ready', { roomId });
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(s.gameNumber, 2);
        assert.equal(app.saved.length, 2);
    } finally {
        clients.forEach(client => client.close());
        await closeApp(app);
    }
});

test('global ban draft starts with open submissions and snapshots both players choices', async () => {
    const app = startApp();
    const clients = [];
    try {
        if (!app.server.listening) await new Promise(resolve => app.server.once('listening', resolve));
        const origin = `http://127.0.0.1:${app.server.address().port}`;
        async function accountCookie(account) {
            const response = await fetch(origin + '/create');
            const cookie = response.headers.get('set-cookie').split(';')[0];
            const sid = signature.unsign(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).slice(2), 'test-secret');
            const stored = await new Promise((resolve, reject) => app.store.get(sid, (err, value) => err ? reject(err) : resolve(value)));
            stored.passport = { user: account };
            await new Promise((resolve, reject) => app.store.set(sid, stored, err => err ? reject(err) : resolve()));
            return cookie;
        }
        async function connect(cookie) {
            const client = new Client(origin.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket', cookie);
            clients.push(client);
            await client.wait('connected');
            return client;
        }
        const alice = await connect(await accountCookie('alice'));
        const bob = await connect(await accountCookie('bob'));
        alice.emit('create_game', { draftType: 'global_ban_sys', tournamentSlug: 'global-test' });
        const { roomId } = await alice.wait('init_game');
        alice.emit('take_seat', { roomId, side: 'blue' });
        await alice.wait('role_update');
        bob.emit('rejoin_game', { roomId });
        await bob.wait('init_game');
        bob.emit('take_seat', { roomId, side: 'red' });
        await bob.wait('role_update');
        const bobEntry = app.globalBanEntries.find(entry => entry.discordId === 'discord-bob');
        bobEntry.characterIds = [];
        alice.emit('player_ready', roomId);
        bob.emit('player_ready', roomId);
        assert.match(await alice.wait('error_msg'), /Both players must confirm/);
        assert.equal(app.sessions[roomId].gameStarted, false);
        bobEntry.characterIds = ['chongyun', 'ayaka', 'eula'];
        alice.emit('player_ready', roomId);
        bob.emit('player_ready', roomId);
        await alice.wait('game_started');
        assert.equal(app.globalTournament.globalBansLocked, false);
        assert.deepEqual([...app.sessions[roomId].globalBans.blue], ['ganyu', 'diona', 'kaeya']);
        assert.deepEqual([...app.sessions[roomId].globalBans.red], ['chongyun', 'ayaka', 'eula']);
        app.globalBanEntries[0].characterIds = ['qiqi', 'shenhe', 'ayaka'];
        assert.deepEqual([...app.sessions[roomId].globalBans.blue], ['ganyu', 'diona', 'kaeya']);
        alice.emit('action', { roomId, charId: 'ganyu' });
        alice.emit('rejoin_game', { roomId });
        await alice.wait('init_game');
        assert.equal(app.sessions[roomId].bans.length, 0);
    } finally {
        clients.forEach(client => client.close());
        await closeApp(app);
    }
});

test('players submit their own bans and admins can correct locked choices', async () => {
    const app = startApp({ env: { ADMIN_DISCORD_ID: 'discord-alice' } });
    try {
        if (!app.server.listening) await new Promise(resolve => app.server.once('listening', resolve));
        const origin = `http://127.0.0.1:${app.server.address().port}`;
        async function cookieFor(account) {
            const response = await fetch(origin + '/create');
            const cookie = response.headers.get('set-cookie').split(';')[0];
            if (account) {
                const sid = signature.unsign(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).slice(2), 'test-secret');
                const stored = await new Promise((resolve, reject) => app.store.get(sid, (err, value) => err ? reject(err) : resolve(value)));
                stored.passport = { user: account };
                await new Promise((resolve, reject) => app.store.set(sid, stored, err => err ? reject(err) : resolve()));
            }
            return cookie;
        }
        async function post(path, cookie, characterIds) {
            return fetch(origin + path, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterIds }) });
        }
        const guest = await cookieFor();
        const alice = await cookieFor('alice');
        const bob = await cookieFor('bob');
        const playerPath = '/tournament/global-test/global-bans';
        assert.equal((await post(playerPath, guest, ['ganyu', 'diona', 'kaeya'])).status, 401);
        assert.equal((await post(playerPath, bob, ['ganyu', 'ganyu', 'kaeya'])).status, 400);
        assert.equal((await post(playerPath, bob, ['ganyu', 'diona', 'kaeya'])).status, 200);
        assert.deepEqual(app.globalBanEntries.find(entry => entry.discordId === 'discord-bob').characterIds,
            ['ganyu', 'diona', 'kaeya']);
        app.globalTournament.globalBansLocked = true;
        assert.equal((await post(playerPath, bob, ['chongyun', 'ayaka', 'eula'])).status, 409);
        const adminPath = `/admin/tournament/${app.globalTournament._id}/global-bans/discord-bob`;
        assert.equal((await post(adminPath, bob, ['chongyun', 'ayaka', 'eula'])).status, 302);
        assert.equal((await post(adminPath, alice, ['chongyun', 'ayaka', 'eula'])).status, 200);
        assert.deepEqual(app.globalBanEntries.find(entry => entry.discordId === 'discord-bob').characterIds,
            ['chongyun', 'ayaka', 'eula']);
    } finally { await closeApp(app); }
});

test('HTTP sessions secure seats, reconnects, draft actions, history and statistics', async () => {
    const app = startApp();
    const clients = [];
    try {
        if (!app.server.listening) await new Promise(resolve => app.server.once('listening', resolve));
        const origin = `http://127.0.0.1:${app.server.address().port}`;
        const wsUrl = origin.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket';
        async function cookieFor(account) {
            const response = await fetch(origin + '/create');
            assert.equal(response.status, 200);
            const cookie = response.headers.get('set-cookie').split(';')[0];
            assert.match(response.headers.get('set-cookie'), /HttpOnly/);
            assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
            if (account) {
                const sid = signature.unsign(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).slice(2), 'test-secret');
                const stored = await new Promise((resolve, reject) => app.store.get(sid, (err, value) => err ? reject(err) : resolve(value)));
                stored.passport = { user: account };
                await new Promise((resolve, reject) => app.store.set(sid, stored, err => err ? reject(err) : resolve()));
            }
            return cookie;
        }
        async function connect(cookie) {
            const client = new Client(wsUrl, cookie); clients.push(client);
            await client.wait('connected'); return client;
        }
        async function state(client, roomId, extra = {}) {
            client.emit('rejoin_game', { roomId, ...extra });
            return client.wait('init_game');
        }
        const unauthenticated = new Client(wsUrl); clients.push(unauthenticated);
        assert.match((await unauthenticated.wait('connect_error')).message, /Session required/);
        unauthenticated.close();
        const aliceCookie = await cookieFor('alice');
        const bobCookie = await cookieFor('bob');
        const guestCookie = await cookieFor();
        const tampered = new Client(wsUrl, guestCookie + 'invalid'); clients.push(tampered);
        assert.match((await tampered.wait('connect_error')).message, /Session required/);
        tampered.close();
        const alice = await connect(aliceCookie), bob = await connect(bobCookie), guest = await connect(guestCookie);
        alice.emit('create_game', { draftType: 'classic' });
        const { roomId } = await alice.wait('init_game');
        alice.emit('take_seat', { roomId, side: 'blue', userId: 'bob', discordId: 'spoof', avatar: 'spoof', nickname: 'Imposter' });
        assert.equal(await alice.wait('role_update'), 'blue');
        let current = (await state(alice, roomId)).state;
        assert.equal(current.blueName, 'Alice');
        assert.equal(current.blueDiscordId, 'discord-alice');
        assert.equal(current.blueAvatar, 'alice-avatar');
        // An attacker even knows the internal ownership key, but cannot use it.
        current = await state(guest, roomId, { userId: 'user:alice', discordId: 'discord-alice' });
        assert.equal(current.role, 'spectator');
        guest.emit('leave_seat', { roomId, userId: 'user:alice' });
        guest.emit('take_seat', { roomId, side: 'blue', userId: 'user:alice' });
        assert.equal((await state(guest, roomId)).state.isBlueTaken, true);
        assert.equal(app.sessions[roomId].bluePlayer, [...app.io.sockets.sockets.values()].find(s => s.data.identity.id === 'user:alice').id);
        // Invalid and occupied targets do not evict the caller's current seat.
        alice.emit('take_seat', { roomId, side: 'invalid' });
        assert.equal((await state(alice, roomId)).role, 'blue');
        guest.emit('take_seat', { roomId, side: 'red', nickname: 'Guest', discordId: 'discord-bob' });
        assert.equal(await guest.wait('role_update'), 'red');
        current = (await state(guest, roomId)).state;
        assert.equal(current.redName, 'Guest');
        assert.equal(current.redDiscordId, null);
        alice.emit('take_seat', { roomId, side: 'red' });
        assert.equal((await state(alice, roomId)).role, 'blue');
        guest.emit('leave_seat', { roomId });
        await guest.wait('role_update');
        bob.emit('take_seat', { roomId, side: 'red' });
        assert.equal(await bob.wait('role_update'), 'red');
        alice.close();
        const reconnected = await connect(aliceCookie);
        assert.equal((await state(reconnected, roomId)).role, 'blue');
        // Guest reconnection uses its server session too.
        guest.emit('create_game', { draftType: 'classic' });
        const guestRoom = (await guest.wait('init_game')).roomId;
        guest.emit('take_seat', { roomId: guestRoom, side: 'blue', nickname: 'Guest' });
        await guest.wait('role_update'); guest.close();
        const returningGuest = await connect(guestCookie);
        assert.equal((await state(returningGuest, guestRoom)).role, 'blue');
        returningGuest.emit('take_seat', { roomId: guestRoom, side: 'red', nickname: 'Guest' });
        assert.equal(await returningGuest.wait('role_update'), 'red');
        current = (await state(returningGuest, guestRoom)).state;
        assert.equal(current.isBlueTaken, false);
        assert.equal(current.isRedTaken, true);
        // Exercise each retained mode through a complete draft.
        const ids = Object.values(require('../characters.json')).flat().map(c => c.id);
        const modes = Object.keys(require('../public/draft-rules').DRAFT_RULES).filter(mode => mode !== 'global_ban_sys');
        for (const mode of modes) {
            reconnected.emit('create_game', { draftType: mode });
            const room = (await reconnected.wait('init_game')).roomId;
            reconnected.emit('take_seat', { roomId: room, side: 'blue' }); await reconnected.wait('role_update');
            bob.emit('take_seat', { roomId: room, side: 'red' }); await bob.wait('role_update');
            returningGuest.emit('player_ready', room);
            await state(returningGuest, room);
            assert.equal(app.sessions[room].ready.blue, false);
            reconnected.emit('player_ready', room); bob.emit('player_ready', room);
            await bob.wait('game_started');
            let index = 0;
            while (!app.sessions[room].draftFinished) {
                const draft = app.sessions[room];
                const player = draft.currentTeam === 'blue' ? reconnected : bob;
                const previousStep = draft.stepIndex;
                if (draft.immunityPhaseActive) player.emit('skip_action', room);
                else {
                    returningGuest.emit('action', { roomId: room, charId: ids.at(-1) });
                    await state(returningGuest, room);
                    assert.equal(draft.stepIndex, previousStep);
                    player.emit('action', { roomId: room, charId: ids[index++] });
                }
                await state(player, room);
            }
            const match = app.saved.find(m => m.roomId === room);
            assert(match);
            assert.equal(match.blueDiscordId, 'discord-alice');
            assert.equal(match.redDiscordId, 'discord-bob');
            const replay = await fetch(origin + '/game/' + room, { headers: { Cookie: aliceCookie } });
            assert.equal(replay.status, 200);
        }
        const history = await fetch(origin + '/history', { headers: { Cookie: aliceCookie } });
        assert.equal(history.status, 200);
        assert(app.statistics.length >= modes.length * 2);
        for (const entry of app.statistics) assert(['discord-alice', 'discord-bob'].includes(entry[0].discordId));
    } finally {
        clients.forEach(client => client.close());
        app.timers.forEach(clearInterval);
        app.server.closeAllConnections();
        await new Promise(resolve => app.io.close(resolve));
    }
});

async function closeApp(app) {
    app.timers.forEach(clearInterval);
    app.server.closeAllConnections();
    await new Promise(resolve => app.io.close(resolve));
}
async function appOrigin(app) {
    if (!app.server.listening) await new Promise(resolve => app.server.once('listening', resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
}

test('login cookie persists for 30 days, survives server restart and renews on a visit', async () => {
    const store = new session.MemoryStore();
    let app = startApp({ store });
    try {
        let origin = await appOrigin(app);
        const first = await fetch(origin + '/create');
        const cookieHeader = first.headers.get('set-cookie');
        const cookie = cookieHeader.split(';')[0];
        assert.match(cookieHeader, /Expires=/i);
        const sid = signature.unsign(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).slice(2), 'test-secret');
        const saved = await new Promise((resolve, reject) => store.get(sid, (error, value) => error ? reject(error) : resolve(value)));
        saved.passport = { user: 'alice' };
        // An existing login with one day remaining must get a fresh 30 days.
        saved.cookie.expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await new Promise((resolve, reject) => store.set(sid, saved, error => error ? reject(error) : resolve()));
        await closeApp(app);
        app = null;
        app = startApp({ store });
        origin = await appOrigin(app);
        const returning = await fetch(origin + '/create', { headers: { Cookie: cookie } });
        assert.equal(returning.status, 200);
        assert.match(await returning.text(), /Alice/);
        const renewed = returning.headers.get('set-cookie');
        const expires = new Date(renewed.match(/Expires=([^;]+)/i)[1]);
        const remaining = expires.getTime() - Date.now();
        assert(remaining > 30 * 24 * 60 * 60 * 1000 - 10000);
        assert(remaining <= 30 * 24 * 60 * 60 * 1000);
        assert.equal(renewed.split(';')[0], cookie);
        await fetch(origin + '/logout', { headers: { Cookie: cookie }, redirect: 'manual' });
        const loggedOut = await fetch(origin + '/create', { headers: { Cookie: cookie } });
        assert.doesNotMatch(await loggedOut.text(), /href="\/logout"/);
    } finally {
        if (app) await closeApp(app);
    }
});

test('production login uses secure cookies behind HTTPS proxy and requires a permanent secret', async () => {
    assert.throws(() => startApp({ env: { SESSION_SECRET: '' } }), /permanent SESSION_SECRET/);
    const app = startApp({ env: { NODE_ENV: 'production' } });
    try {
        const origin = await appOrigin(app);
        const httpResponse = await fetch(origin + '/create');
        assert.equal(httpResponse.headers.get('set-cookie'), null);
        const httpsResponse = await fetch(origin + '/create', { headers: { 'X-Forwarded-Proto': 'https' } });
        assert.match(httpsResponse.headers.get('set-cookie'), /; Secure/);
        assert.match(httpsResponse.headers.get('set-cookie'), /; HttpOnly/);
        assert.match(httpsResponse.headers.get('set-cookie'), /SameSite=Lax/);
    } finally { await closeApp(app); }
});

test('all templates compile and game/create browser scripts parse', () => {
    for (const directory of ['views/pages', 'views/partials']) {
        for (const file of fs.readdirSync(path.join(root, directory))) {
            if (file.endsWith('.ejs')) ejs.compile(fs.readFileSync(path.join(root, directory, file), 'utf8'), { filename: path.join(root, directory, file) });
        }
    }
    for (const page of ['create', 'game']) for (const user of [null, { username: 'Alice', discordId: 'alice', avatar: 'avatar' }]) {
        const filename = path.join(root, 'views/pages', page + '.ejs');
        const html = ejs.render(fs.readFileSync(filename, 'utf8'), { roomId: 'TEST', user, savedData: null,
            chars: require('../characters.json'), globalBanTournaments: [], selectedTournament: '' }, { filename });
        for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
        assert(!html.includes('draft_user_id'));
    }
});
