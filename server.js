require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');

// Модели БД
const User = require('./models/User');
const Match = require('./models/Match'); // <-- Добавили модель матча

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === ПОДКЛЮЧЕНИЕ К MONGODB ===
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// === НАСТРОЙКА СЕССИЙ ===
const sessionMiddleware = session({
    secret: 'gitcg-super-secret-key',
    resave: false,
    saveUninitialized: false
});
app.use(sessionMiddleware);

// === НАСТРОЙКА DISCORD PASSPORT ===
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
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
    } catch (err) {
        return done(err, null);
    }
}));

// Настройка EJS и статики
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const CHARACTERS_BY_ELEMENT = require('./characters.json');
const { DRAFT_RULES, IMMUNITY_ORDER } = require('./public/draft-rules.js');

const indexRouter = require('./routes/index');
app.use('/', indexRouter);

// === ЛОГИКА СОКЕТОВ ===
const sessions = {};

io.on('connection', (socket) => {
    socket.on('create_game', ({ nickname, draftType, userId }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const type = draftType || 'gitcg';
        sessions[roomId] = {
            id: roomId, bluePlayer: socket.id, blueUserId: userId, redPlayer: null, redUserId: null,
            spectators: [], blueName: nickname || 'Player 1', redName: 'Waiting...',
            draftType: type, draftOrder: DRAFT_RULES[type], gameStarted: false, immunityPhaseActive: false,
            lastActive: Date.now(), finishedAt: null, stepIndex: 0, currentTeam: null, currentAction: null,
            immunityStepIndex: 0, immunityPool: [], immunityBans: [], timer: 60, blueReserve: 300, redReserve: 300,
            timerInterval: null, bans: [], bluePicks: [], redPicks: [], ready: { blue: false, red: false }
        };
        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'blue', state: getPublicState(sessions[roomId]), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('join_game', ({roomId, nickname, asSpectator, userId}) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Room not found');
        session.lastActive = Date.now();
        if (asSpectator || (session.bluePlayer && session.redPlayer)) {
            session.spectators.push(socket.id); socket.join(roomId);
            return socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
        }
        if (!session.redPlayer) {
            session.redPlayer = socket.id; session.redUserId = userId; session.redName = nickname || 'Player 2';
            socket.join(roomId); socket.emit('init_game', { roomId, role: 'red', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
            io.to(roomId).emit('update_state', getPublicState(session));
        } 
    });

    socket.on('rejoin_game', ({ roomId, userId }) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Session expired');
        let role = 'spectator';
        if (session.blueUserId === userId) { session.bluePlayer = socket.id; role = 'blue'; } 
        else if (session.redUserId === userId) { session.redPlayer = socket.id; role = 'red'; }
        else { session.spectators.push(socket.id); }
        session.lastActive = Date.now(); socket.join(roomId);
        socket.emit('init_game', { roomId, role, state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
        io.to(roomId).emit('update_state', getPublicState(session));
    });

    socket.on('player_ready', (roomId) => {
        const session = sessions[roomId];
        if (!session) return;
        if (socket.id === session.bluePlayer) session.ready.blue = true;
        if (socket.id === session.redPlayer) session.ready.red = true;
        io.to(roomId).emit('update_state', getPublicState(session));
        if (session.ready.blue && session.ready.red && !session.gameStarted) {
            session.gameStarted = true;
            if (session.draftType === 'gitcg_cup_2') {
                session.immunityPhaseActive = true; session.currentTeam = IMMUNITY_ORDER[0].team; session.currentAction = IMMUNITY_ORDER[0].type;
            } else {
                session.currentTeam = session.draftOrder[0].team; session.currentAction = session.draftOrder[0].type;
            }
            startTimer(roomId); io.to(roomId).emit('game_started'); io.to(roomId).emit('update_state', getPublicState(session));
        }
    });

    socket.on('skip_action', (roomId) => {
        const session = sessions[roomId];
        if (!session || !session.immunityPhaseActive) return;
        if (session.currentAction === 'immunity_ban') session.immunityBans.push('skipped');
        else if (session.currentAction === 'immunity_pick') session.immunityPool.push('skipped');
        nextImmunityStep(roomId);
    });

    socket.on('action', ({ roomId, charId }) => {
        const session = sessions[roomId];
        if (!session || !session.gameStarted) return;
        if (session.immunityPhaseActive) {
            if (session.currentAction === 'immunity_ban') session.immunityBans.push(charId);
            else session.immunityPool.push(charId);
            nextImmunityStep(roomId);
        } else {
            if (session.currentAction === 'ban') session.bans.push({ id: charId, team: session.currentTeam });
            else session.currentTeam === 'blue' ? session.bluePicks.push(charId) : session.redPicks.push(charId);
            nextStep(roomId);
        }
    });
});

function nextImmunityStep(roomId) {
    const s = sessions[roomId]; s.immunityStepIndex++; s.timer = 60;
    if (s.immunityStepIndex >= IMMUNITY_ORDER.length) {
        s.immunityPhaseActive = false; s.stepIndex = 0;
        s.currentTeam = s.draftOrder[0].team; s.currentAction = s.draftOrder[0].type;
    } else {
        const c = IMMUNITY_ORDER[s.immunityStepIndex]; s.currentTeam = c.team; s.currentAction = c.type;
    }
    io.to(roomId).emit('update_state', getPublicState(s));
}

function nextStep(roomId) {
    const s = sessions[roomId]; s.stepIndex++; s.timer = 60;
    if (s.stepIndex >= s.draftOrder.length) {
        s.finishedAt = Date.now(); 
        io.to(roomId).emit('game_over', getPublicState(s)); 
        clearInterval(s.timerInterval); 
        
        // СОХРАНЕНИЕ МАТЧА В БАЗУ ДАННЫХ
        Match.create({
            roomId: s.id,
            draftType: s.draftType,
            blueName: s.blueName,
            redName: s.redName,
            blueDiscordId: s.blueUserId,
            redDiscordId: s.redUserId,
            bans: s.bans,
            bluePicks: s.bluePicks,
            redPicks: s.redPicks
        }).then(() => console.log(`✅ Match ${s.id} saved to DB!`))
          .catch(err => console.error("❌ Error saving match:", err));

        return;
    }
    const c = s.draftOrder[s.stepIndex]; s.currentTeam = c.team; s.currentAction = c.type;
    io.to(roomId).emit('update_state', getPublicState(s));
}

function startTimer(roomId) {
    const s = sessions[roomId];
    if (s.timerInterval) clearInterval(s.timerInterval);
    s.timerInterval = setInterval(() => {
        if (s.timer > 0) s.timer--;
        else {
            if (s.currentTeam === 'blue') { s.blueReserve--; if(s.blueReserve <= 0) { s.blueReserve=0; autoPick(roomId); } }
            else { s.redReserve--; if(s.redReserve <= 0) { s.redReserve=0; autoPick(roomId); } }
        }
        io.to(roomId).emit('timer_tick', { main: s.timer, blueReserve: s.blueReserve, redReserve: s.redReserve });
    }, 1000);
}

function autoPick(roomId) {
    const session = sessions[roomId];
    let allFlat = [];
    Object.values(CHARACTERS_BY_ELEMENT).forEach(arr => allFlat.push(...arr));
    session.lastActive = Date.now();

    if (session.immunityPhaseActive) {
        const available = allFlat.filter(c => !session.immunityBans.includes(c.id) && !session.immunityPool.includes(c.id));
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

    const available = allFlat.filter(c => {
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

function getPublicState(session) {
    return {
        stepIndex: session.stepIndex + 1,
        currentTeam: session.currentTeam, currentAction: session.currentAction,
        bans: session.bans, bluePicks: session.bluePicks, redPicks: session.redPicks,
        immunityPhaseActive: session.immunityPhaseActive, immunityPool: session.immunityPool, immunityBans: session.immunityBans,
        blueName: session.blueName, redName: session.redName, draftType: session.draftType,
        ready: session.ready, gameStarted: session.gameStarted
    };
}

setInterval(() => {
    const now = Date.now();
    Object.keys(sessions).forEach(roomId => {
        if (now - sessions[roomId].lastActive > 3600000) {
            if (sessions[roomId].timerInterval) clearInterval(sessions[roomId].timerInterval);
            delete sessions[roomId];
        }
    });
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
