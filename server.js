require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const { ensureGuestIdentity, socketIdentity } = require('./lib/socket-identity');

const sessionSecret = process.env.SESSION_SECRET?.trim();
if (!sessionSecret) throw new Error('Set a permanent SESSION_SECRET in the server environment before starting the app.');
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === 'production';

const User = require('./models/User');
const Match = require('./models/Match');
const Tournament = require('./models/Tournament');
const TournamentGlobalBan = require('./models/TournamentGlobalBan');
const { validateGlobalBans, validIds } = require('./lib/global-bans');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 1. DB CONNECT ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 2. MIDDLEWARE ---
if (isProduction) app.set('trust proxy', 1);
const sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI, ttl: sessionLifetime / 1000 }),
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: sessionLifetime }
});
app.use(sessionMiddleware);
app.use(ensureGuestIdentity);
io.engine.use(sessionMiddleware);
io.use(socketIdentity(User));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) { done(err, null); }
});

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.NODE_ENV === 'production' 
        ? 'https://tcg-ww.onrender.com/auth/discord/callback' 
        : 'http://localhost:3000/auth/discord/callback',
    scope: ['identify']
}, async function(accessToken, refreshToken, profile, done) {
    try {
        let user = await User.findOne({ discordId: profile.id });
        if (!user) {
            user = await User.create({
                discordId: profile.id,
                username: profile.global_name || profile.username,
                avatar: profile.avatar
            });
        } else {
            user.username = profile.global_name || profile.username;
            user.avatar = profile.avatar;
            await user.save();
        }
        return done(null, user);
    } catch (err) { return done(err, null); }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const CHARACTERS_BY_ELEMENT = require('./characters.json');
const { DRAFT_RULES, IMMUNITY_ORDER } = require('./public/draft-rules.js'); 

const indexRouter = require('./routes/index');
app.use('/', indexRouter);

const sessions = {};
app.locals.isLiveDraftRoom = roomId => !!sessions[roomId];

// --- 3. SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    const identity = socket.data.identity;
    const userId = identity.id;
    
    socket.on('create_game', async ({ draftType, tournamentSlug, bestOf } = {}) => {
        try {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const type = draftType || 'gitcg';
        if (!Object.hasOwn(DRAFT_RULES, type)) {
            return socket.emit('error_msg', 'Unsupported draft mode');
        }
        if (![1, 2, 3, 5, 7].includes(bestOf)) bestOf = 1;
        let tournament = null;
        if (type === 'global_ban_sys') {
            if (typeof tournamentSlug !== 'string' || !tournamentSlug || tournamentSlug.length > 100) {
                return socket.emit('error_msg', 'Select an available global bans tournament.');
            }
            tournament = await Tournament.findOne({ slug: tournamentSlug, type: 'tournament', isMine: true, isLive: true, globalBansEnabled: true });
            if (!tournament) return socket.emit('error_msg', 'Select an available global bans tournament.');
        }
        
        // Раздельные стартовые таймеры: 30 / 130 для moba_3phase, 45 / 180 для остальных
        const isMoba = type === 'moba_3phase' || type === 'global_ban_sys';
        const baseTimer = isMoba ? 30 : 45;
        const baseReserve = isMoba ? 130 : 180;

        sessions[roomId] = {
            id: roomId, 
            bluePlayer: null, blueUserId: null, blueDiscordId: null, blueAvatar: null,
            redPlayer: null, redUserId: null, redDiscordId: null, redAvatar: null,
            spectators: [socket.id], blueName: 'Waiting...', redName: 'Waiting...',
            draftType: type, draftOrder: DRAFT_RULES[type], gameStarted: false,
            tournamentId: tournament?._id || null, tournamentSlug: tournament?.slug || null,
            globalBanCount: tournament?.globalBanCount || 0,
            globalBans: { blue: [], red: [] }, starting: false,
            immunityPhaseActive: false, immunityStepIndex: 0, immunityPool: [], immunityBans: [],
            lastActive: Date.now(), stepIndex: 0, currentTeam: null, currentAction: null,
            timer: baseTimer, blueReserve: baseReserve, redReserve: baseReserve, timerInterval: null,
            bans: [], bluePicks: [], redPicks: [], ready: { blue: false, red: false },
            draftFinished: false, finishedAt: null,
            bestOf, gameNumber: 1, games: [], score: { player1: 0, player2: 0 },
            resultVotes: { blue: null, red: null }, nextReady: { blue: false, red: false },
            confirmedWinner: null, seriesFinished: false, savePromises: {}
        };

        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(sessions[roomId]), chars: CHARACTERS_BY_ELEMENT });
        } catch (error) { console.error(error); socket.emit('error_msg', 'Unable to create room.'); }
    });

    socket.on('join_game', ({roomId}) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Room not found');
        
        session.lastActive = Date.now();
        session.spectators.push(socket.id);
        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('rejoin_game', ({ roomId } = {}) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Session expired');
        
        session.lastActive = Date.now();
        let role = 'spectator';
        
        if (session.blueUserId === userId) { 
            session.bluePlayer = socket.id; role = 'blue';
        } else if (session.redUserId === userId) { 
            session.redPlayer = socket.id; role = 'red';
        } else {
            session.spectators.push(socket.id);
        }
        
        socket.join(roomId);
        socket.emit('init_game', { roomId, role, state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('take_seat', ({ roomId, side, nickname } = {}) => {
        const session = sessions[roomId];
        if (!session || session.gameStarted || session.starting) return;
        if (side !== 'blue' && side !== 'red') return;
        if (session.draftType === 'global_ban_sys' && !identity.discordId) return socket.emit('error_msg', 'Sign in with Discord for this draft.');
        if (session[`${side}UserId`] && session[`${side}UserId`] !== userId) return;
        socket.join(roomId);
        const playerName = identity.nickname || (typeof nickname === 'string' && nickname.trim().slice(0, 32)) || 'Player';

        if (session.blueUserId === userId) { 
            session.blueUserId = null; session.bluePlayer = null; session.blueName = 'Waiting...'; session.ready.blue = false;
            session.blueDiscordId = null; session.blueAvatar = null;
        }
        if (session.redUserId === userId) { 
            session.redUserId = null; session.redPlayer = null; session.redName = 'Waiting...'; session.ready.red = false;
            session.redDiscordId = null; session.redAvatar = null;
        }

        if (side === 'blue' && !session.blueUserId) {
            session.blueUserId = userId; session.bluePlayer = socket.id; 
            session.blueName = playerName; session.blueDiscordId = identity.discordId; session.blueAvatar = identity.avatar;
            io.to(socket.id).emit('role_update', 'blue');
        } else if (side === 'red' && !session.redUserId) {
            session.redUserId = userId; session.redPlayer = socket.id; 
            session.redName = playerName; session.redDiscordId = identity.discordId; session.redAvatar = identity.avatar;
            io.to(socket.id).emit('role_update', 'red');
        }

        io.to(roomId).emit('update_state', getPublicState(session));
    });

    socket.on('leave_seat', ({ roomId } = {}) => {
        const session = sessions[roomId];
        if (!session || session.gameStarted || session.starting) return;
        if (session.blueUserId !== userId && session.redUserId !== userId) return;

        if (session.blueUserId === userId) { 
            session.blueUserId = null; session.bluePlayer = null; session.blueName = 'Waiting...'; session.ready.blue = false;
            session.blueDiscordId = null; session.blueAvatar = null;
        }
        if (session.redUserId === userId) { 
            session.redUserId = null; session.redPlayer = null; session.redName = 'Waiting...'; session.ready.red = false;
            session.redDiscordId = null; session.redAvatar = null;
        }

        io.to(socket.id).emit('role_update', 'spectator');
        io.to(roomId).emit('update_state', getPublicState(session));
    });

    socket.on('player_ready', async (roomId) => {
        const session = sessions[roomId];
        if (!session || session.gameStarted || session.starting) return;
        session.lastActive = Date.now();
        if (socket.id !== session.bluePlayer && socket.id !== session.redPlayer) return;
        if (socket.id === session.bluePlayer) session.ready.blue = true;
        if (socket.id === session.redPlayer) session.ready.red = true;
        io.to(roomId).emit('update_state', getPublicState(session));
        
        if (session.ready.blue && session.ready.red && !session.gameStarted) {
            if (session.draftType === 'global_ban_sys' && session.gameNumber === 1) {
                session.starting = true;
                try {
                    const tournament = await Tournament.findById(session.tournamentId);
                    if (!tournament?.globalBansEnabled || !tournament.isLive) {
                        session.ready = { blue: false, red: false };
                        io.to(roomId).emit('update_state', getPublicState(session));
                        io.to(roomId).emit('error_msg', 'Global bans are unavailable for this tournament.');
                        return;
                    }
                    session.globalBanCount = tournament.globalBanCount;
                    const entries = await TournamentGlobalBan.find({ tournamentId: session.tournamentId,
                        discordId: { $in: [session.blueDiscordId, session.redDiscordId] } }).lean();
                    const byPlayer = new Map(entries.map(entry => [entry.discordId, entry.characterIds]));
                    const blue = byPlayer.get(session.blueDiscordId);
                    const red = byPlayer.get(session.redDiscordId);
                    if (!session.blueDiscordId || !session.redDiscordId || session.blueDiscordId === session.redDiscordId ||
                        !validateGlobalBans(blue, session.globalBanCount) || !validateGlobalBans(red, session.globalBanCount)) {
                        session.ready = { blue: false, red: false };
                        io.to(roomId).emit('update_state', getPublicState(session));
                        io.to(roomId).emit('error_msg', 'Both players must confirm their global bans on the tournament page.');
                        return;
                    }
                    session.globalBans = { blue: [...blue], red: [...red] };
                } catch (error) {
                    console.error(error);
                    session.ready = { blue: false, red: false };
                    io.to(roomId).emit('error_msg', 'Unable to load global bans.');
                    return;
                } finally { session.starting = false; }
            }
            session.gameStarted = true;
            if (session.draftType === 'gitcg_cup_2') {
                session.immunityPhaseActive = true;
                session.currentTeam = IMMUNITY_ORDER[0].team;
                session.currentAction = IMMUNITY_ORDER[0].type;
            } else {
                session.currentTeam = session.draftOrder[0].team;
                session.currentAction = session.draftOrder[0].type;
            }
            startTimer(roomId); 
            io.to(roomId).emit('game_started'); 
            io.to(roomId).emit('update_state', getPublicState(session));
        }
    });

    socket.on('skip_action', (roomId) => {
        const session = sessions[roomId];
        if (!session || !session.immunityPhaseActive) return;
        const isBlueTurn = session.currentTeam === 'blue' && socket.id === session.bluePlayer;
        const isRedTurn = session.currentTeam === 'red' && socket.id === session.redPlayer;
        if (!isBlueTurn && !isRedTurn) return;

        session.lastActive = Date.now();
        if (session.currentAction === 'immunity_ban') session.immunityBans.push('skipped');
        else if (session.currentAction === 'immunity_pick') session.immunityPool.push('skipped');
        nextImmunityStep(roomId);
    });

    socket.on('action', ({ roomId, charId }) => {
        const session = sessions[roomId];
        if (!session || !session.redPlayer || !session.gameStarted || session.draftFinished) return;

        session.lastActive = Date.now();
        const isBlue = session.currentTeam === 'blue';
        if ((isBlue && socket.id !== session.bluePlayer) || (!isBlue && socket.id !== session.redPlayer)) return;
        if (!validIds.has(charId) || session.globalBans.blue.includes(charId) || session.globalBans.red.includes(charId)) return;

        if (session.immunityPhaseActive) {
            if (session.immunityBans.includes(charId) || session.immunityPool.includes(charId)) return;
            if (session.currentAction === 'immunity_ban') session.immunityBans.push(charId);
            else session.immunityPool.push(charId);
            nextImmunityStep(roomId);
            return;
        }

        const isImmune = session.immunityPool.filter(id => id !== 'skipped').includes(charId);
        const currentStepData = session.draftOrder[session.stepIndex];
        const isImmuneStep = currentStepData && currentStepData.immunity === true;

        if (session.bans.some(b => b.id === charId)) return;

        if (session.currentAction === 'ban') {
            if (isImmune) return; 
            session.bans.push({ id: charId, team: session.currentTeam });
        } else {
            if (isImmune && !isImmuneStep) return; 
            
            const iHaveIt = isBlue ? session.bluePicks.includes(charId) : session.redPicks.includes(charId);
            if (iHaveIt) return; 

            const enemyHasIt = isBlue ? session.redPicks.includes(charId) : session.bluePicks.includes(charId);
            if (enemyHasIt && !isImmune) return;

            if (isBlue) session.bluePicks.push(charId);
            else session.redPicks.push(charId);
        }
        
        nextStep(roomId);
    });

    socket.on('vote_result', async ({ roomId, winner, gameNumber } = {}) => {
        const s = sessions[roomId];
        if (!s || !['blue', 'red'].includes(winner)) return;
        const number = gameNumber === undefined ? s.gameNumber : gameNumber;
        if (!Number.isInteger(number) || number < 1 || number > s.games.length) return;
        const game = s.games[number - 1];
        if (!game?.draftFinished || game.winner) return;
        const side = userId === game.blueUserId ? 'blue' : userId === game.redUserId ? 'red' : null;
        if (!side) return;
        game.resultVotes[side] = game.resultVotes[side] === winner ? null : winner;
        s.lastActive = Date.now();
        if (game.resultVotes.blue && game.resultVotes.blue === game.resultVotes.red) {
            game.winner = winner;
            const score = { player1: 0, player2: 0 };
            for (const played of s.games) {
                if (!played.winner) continue;
                const player = (played.gameNumber % 2 === 1) === (played.winner === 'blue') ? 'player1' : 'player2';
                score[player]++;
            }
            s.score = score;
            game.score = { ...score };
            s.seriesFinished = (s.games.length >= s.bestOf && s.games.every(played => !!played.winner)) ||
                (s.bestOf !== 2 && Math.max(score.player1, score.player2) >= Math.ceil(s.bestOf / 2));
            try {
                await s.savePromises[number];
                await Match.updateOne({ roomId, gameNumber: number }, { $set: { winner, score: game.score, seriesFinished: s.seriesFinished } });
            } catch (error) { console.error(error); }
        }
        if (number === s.gameNumber) {
            s.resultVotes = game.resultVotes;
            s.confirmedWinner = game.winner;
        }
        io.to(roomId).emit('update_state', getPublicState(s));
    });

    socket.on('next_game_ready', ({ roomId } = {}) => {
        const s = sessions[roomId];
        if (!s?.draftFinished || s.seriesFinished || s.gameNumber >= s.bestOf) return;
        const side = socket.id === s.bluePlayer ? 'blue' : socket.id === s.redPlayer ? 'red' : null;
        if (!side) return;
        s.nextReady[side] = !s.nextReady[side];
        s.lastActive = Date.now();
        if (s.nextReady.blue && s.nextReady.red) advanceSeries(s);
        io.to(roomId).emit('update_state', getPublicState(s));
    });
});

function advanceSeries(s) {
    for (const field of ['Player', 'UserId', 'DiscordId', 'Avatar', 'Name']) {
        const blue = `blue${field}`, red = `red${field}`;
        [s[blue], s[red]] = [s[red], s[blue]];
    }
    [s.globalBans.blue, s.globalBans.red] = [s.globalBans.red, s.globalBans.blue];
    s.gameNumber++;
    s.gameStarted = false;
    s.draftFinished = false;
    s.finishedAt = null;
    s.stepIndex = 0;
    s.currentTeam = null;
    s.currentAction = null;
    s.immunityPhaseActive = false;
    s.immunityStepIndex = 0;
    s.immunityPool = [];
    s.immunityBans = [];
    s.bans = [];
    s.bluePicks = [];
    s.redPicks = [];
    s.ready = { blue: false, red: false };
    s.resultVotes = { blue: null, red: null };
    s.nextReady = { blue: false, red: false };
    s.confirmedWinner = null;
    const isMoba = s.draftType === 'moba_3phase' || s.draftType === 'global_ban_sys';
    s.timer = isMoba ? 30 : 45;
    s.blueReserve = s.redReserve = isMoba ? 130 : 180;
    io.to(s.bluePlayer).emit('role_update', 'blue');
    io.to(s.redPlayer).emit('role_update', 'red');
    io.to(s.id).emit('series_game_changed');
}

function nextImmunityStep(roomId) {
    const s = sessions[roomId]; 
    s.immunityStepIndex++; 
    s.timer = 45;
    if (s.immunityStepIndex >= IMMUNITY_ORDER.length) {
        s.immunityPhaseActive = false; s.stepIndex = 0;
        s.currentTeam = s.draftOrder[0].team; s.currentAction = s.draftOrder[0].type;
    } else {
        const c = IMMUNITY_ORDER[s.immunityStepIndex]; s.currentTeam = c.team; s.currentAction = c.type;
    }
    io.to(roomId).emit('update_state', getPublicState(s));
}

function nextStep(roomId) {
    const s = sessions[roomId]; 
    s.stepIndex++; 
    // Сброс таймера хода: 30 сек для moba_3phase, 45 сек для остальных
    s.timer = (s.draftType === 'moba_3phase' || s.draftType === 'global_ban_sys') ? 30 : 45;

    if (s.stepIndex >= s.draftOrder.length) {
        clearInterval(s.timerInterval);
        s.draftFinished = true;
        s.finishedAt = Date.now();
        s.games.push({ ...getDraftSnapshot(s), gameNumber: s.gameNumber,
            blueUserId: s.blueUserId, redUserId: s.redUserId,
            resultVotes: { blue: null, red: null }, winner: null, score: { ...s.score } });
        s.savePromises[s.gameNumber] = saveMatchImmediately(s);
        return;
    }
    const c = s.draftOrder[s.stepIndex]; 
    s.currentTeam = c.team; 
    s.currentAction = c.type;
    io.to(roomId).emit('update_state', getPublicState(s));
}

function startTimer(roomId) {
    const session = sessions[roomId];
    if (session.timerInterval) clearInterval(session.timerInterval);
    
    session.timerInterval = setInterval(() => {
        if (session.timer > 0) {
            session.timer--;
        } else {
            if (session.currentTeam === 'blue') {
                session.blueReserve--;
                if (session.blueReserve <= 0) {
                    session.blueReserve = 0;
                    autoPick(roomId);
                }
            } else {
                session.redReserve--;
                if (session.redReserve <= 0) {
                    session.redReserve = 0;
                    autoPick(roomId);
                }
            }
        }
        io.to(roomId).emit('timer_tick', { main: session.timer, blueReserve: session.blueReserve, redReserve: session.redReserve });
    }, 1000);
}

function autoPick(roomId) {
    const session = sessions[roomId];
    let available = [];
    
    Object.values(CHARACTERS_BY_ELEMENT).forEach(arr => available.push(...arr));
    
    session.lastActive = Date.now();

    // Особый случай для нового режима MOBA 3-Phase при истощении времени:
    if (session.draftType === 'moba_3phase' || session.draftType === 'global_ban_sys') {
        if (session.currentAction === 'ban') {
            // Бан просто сгорает
            session.bans.push({ id: 'skipped', team: session.currentTeam });
            nextStep(roomId);
            return;
        } else {
            // Автопик случайного незанятого персонажа
            const taken = [...session.bans.map(b => b.id), ...session.bluePicks, ...session.redPicks,
                ...session.globalBans.blue, ...session.globalBans.red];
            available = available.filter(c => !taken.includes(c.id));
            if (available.length > 0) {
                const randomChar = available[Math.floor(Math.random() * available.length)];
                if (session.currentTeam === 'blue') session.bluePicks.push(randomChar.id);
                else session.redPicks.push(randomChar.id);
            }
            nextStep(roomId);
            return;
        }
    }

    if (session.immunityPhaseActive) {
        available = available.filter(c => {
            return !session.immunityBans.includes(c.id) && !session.immunityPool.includes(c.id);
        });
        if (available.length > 0) {
            const r = available[Math.floor(Math.random() * available.length)];
            if (session.currentAction === 'immunity_ban') session.immunityBans.push(r.id);
            else session.immunityPool.push(r.id);
            nextImmunityStep(roomId);
        } else {
            if (session.currentAction === 'immunity_ban') session.immunityBans.push('skipped');
            else session.immunityPool.push('skipped');
            nextImmunityStep(roomId);
        }
        return;
    }

    const currentConfig = session.draftOrder[session.stepIndex];
    const isImmunityTurn = !!currentConfig.immunity;

    available = available.filter(c => {
        const isBanned = session.bans.some(b => b.id === c.id);
        if (isBanned) return false;
        
        const myPicks = session.currentTeam === 'blue' ? session.bluePicks : session.redPicks;
        const oppPicks = session.currentTeam === 'blue' ? session.redPicks : session.bluePicks;
        if (myPicks.includes(c.id)) return false;
        
        const isInImmunityPool = session.immunityPool.includes(c.id);
        if (isInImmunityPool) {
            if (session.currentAction === 'ban') return false;
            if (session.currentAction === 'pick' && !isImmunityTurn) return false;
        }

        if (oppPicks.includes(c.id)) {
            if (isImmunityTurn && isInImmunityPool) return true;
            return false;
        }
        return true;
    });

    if (available.length > 0) {
        const randomChar = available[Math.floor(Math.random() * available.length)];
        if (session.currentAction === 'ban') {
            session.bans.push({ id: randomChar.id, team: session.currentTeam });
        } else {
            if (session.currentTeam === 'blue') session.bluePicks.push(randomChar.id);
            else session.redPicks.push(randomChar.id);
        }
        nextStep(roomId);
    }
}

async function saveMatchImmediately(s) {
    io.to(s.id).emit('update_state', getPublicState(s)); 
    io.to(s.id).emit('game_over', getPublicState(s)); 
    try {
        await Match.create({
            roomId: s.id, draftType: s.draftType, blueName: s.blueName, redName: s.redName,
            bestOf: s.bestOf, gameNumber: s.gameNumber,
            blueDiscordId: s.blueDiscordId, redDiscordId: s.redDiscordId,
            blueAvatar: s.blueAvatar, redAvatar: s.redAvatar, 
            bans: s.bans, bluePicks: s.bluePicks, redPicks: s.redPicks,
            immunityPool: s.immunityPool, immunityBans: s.immunityBans,
            tournamentSlug: s.tournamentSlug, globalBans: s.globalBans
        });
        if (s.blueDiscordId) await User.updateOne({ discordId: s.blueDiscordId }, { $inc: { gamesPlayed: 1 } });
        if (s.redDiscordId) await User.updateOne({ discordId: s.redDiscordId }, { $inc: { gamesPlayed: 1 } });

        const count = await Match.countDocuments();
        if (count > 10000) {
            const oldOnes = await Match.find().sort({ date: 1 }).limit(count - 10000);
            await Match.deleteMany({ _id: { $in: oldOnes.map(m => m._id) } });
        }
    } catch (e) { console.error(e); }
}

function getPublicState(session) {
    return {
        ...getDraftSnapshot(session),
        bestOf: session.bestOf, gameNumber: session.gameNumber,
        games: session.games.map(({ blueUserId, redUserId, ...game }) => game), score: session.score,
        resultVotes: session.resultVotes, nextReady: session.nextReady,
        confirmedWinner: session.confirmedWinner, seriesFinished: session.seriesFinished
    };
}

function getDraftSnapshot(session) {
    return {
        stepIndex: session.stepIndex + 1,
        currentTeam: session.currentTeam, currentAction: session.currentAction,
        bans: session.bans, bluePicks: session.bluePicks, redPicks: session.redPicks,
        blueName: session.blueName, redName: session.redName, draftType: session.draftType,
        blueDiscordId: session.blueDiscordId, redDiscordId: session.redDiscordId, 
        blueAvatar: session.blueAvatar, redAvatar: session.redAvatar,
        isBlueTaken: !!session.blueUserId, isRedTaken: !!session.redUserId,
        immunityPhaseActive: session.immunityPhaseActive,
        immunityPool: session.immunityPool || [], immunityBans: session.immunityBans || [],
        globalBans: { blue: [...(session.globalBans?.blue || [])], red: [...(session.globalBans?.red || [])] }, tournamentSlug: session.tournamentSlug,
        draftFinished: session.draftFinished, ready: session.ready, gameStarted: session.gameStarted
    };
}

const CLEANUP_INTERVAL = 60 * 1000; 
const SESSION_TIMEOUT = 60 * 60 * 1000; 

// Resume interrupted payouts and close expired betting events independently of drafts.
const bettingService = require('./lib/betting-service');
setInterval(() => {
    bettingService.maintenance().catch(error => console.error('Betting maintenance:', error.message));
}, 10000).unref();

setInterval(() => {
    const now = Date.now();
    for (const roomId in sessions) {
        const session = sessions[roomId];
        const room = io.sockets.adapter.rooms.get(roomId);
        const isEmpty = !room || room.size === 0;

        const isOldFinished = session.finishedAt && (now - session.finishedAt > SESSION_TIMEOUT);
        const isAbandoned = isEmpty && (now - session.lastActive > SESSION_TIMEOUT);

        if (isOldFinished || isAbandoned) {
            if (session.timerInterval) clearInterval(session.timerInterval);
            delete sessions[roomId];
        }
    }
}, CLEANUP_INTERVAL);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
