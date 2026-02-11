const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === НАСТРОЙКА СЕССИЙ ===
const sessionMiddleware = session({
    secret: 'gitcg-super-secret-key',
    resave: false,
    saveUninitialized: true
});
app.use(sessionMiddleware);

// === НАСТРОЙКА DISCORD PASSPORT ===
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: '1471167069235183812',
    clientSecret: '87BRTxxfxwbC1JAiuAnwPzkM8GL-siDx',
    callbackURL: process.env.NODE_ENV === 'production' 
        ? 'https://tcg-ww.onrender.com/auth/discord/callback' 
        : 'http://localhost:3000/auth/discord/callback',
    scope: ['identify']
}, function(accessToken, refreshToken, profile, done) {
    return done(null, profile);
}));

// Настройка EJS и статики
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// === ДАННЫЕ И ПРАВИЛА ===
const CHARACTERS_BY_ELEMENT = require('./characters.json');
const { DRAFT_RULES, IMMUNITY_ORDER } = require('./public/draft-rules.js');

// === МАРШРУТЫ (ROUTES) ===
const indexRouter = require('./routes/index');
app.use('/', indexRouter);

// === ЛОГИКА ИГРОВЫХ СЕССИЙ ===
const sessions = {};

io.on('connection', (socket) => {
    
    // Создание игры
    socket.on('create_game', ({ nickname, draftType, userId }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const type = draftType || 'gitcg';
        const selectedSchema = DRAFT_RULES[type];

        sessions[roomId] = {
            id: roomId, 
            bluePlayer: socket.id, 
            blueUserId: userId, 
            redPlayer: null,
            redUserId: null,
            spectators: [], 
            blueName: nickname || 'Player 1', 
            redName: 'Waiting...',
            draftType: type,
            draftOrder: selectedSchema, 
            gameStarted: false,
            immunityPhaseActive: false,
            lastActive: Date.now(), 
            finishedAt: null,       
            stepIndex: 0, 
            currentTeam: null, 
            currentAction: null,
            immunityStepIndex: 0,
            immunityPool: [], 
            immunityBans: [], 
            timer: 45, 
            blueReserve: 180, 
            redReserve: 180, 
            timerInterval: null,
            bans: [], 
            bluePicks: [], redPicks: [],
            ready: { blue: false, red: false }
        };
        
        socket.join(roomId);
        socket.emit('init_game', { 
            roomId, role: 'blue', 
            state: getPublicState(sessions[roomId]), chars: CHARACTERS_BY_ELEMENT 
        });
    });

    // Присоединение
    socket.on('join_game', ({roomId, nickname, asSpectator, userId}) => {
        const session = sessions[roomId];
        if (!session) {
            socket.emit('error_msg', 'Room not found');
            return;
        }
        session.lastActive = Date.now();

        if (asSpectator || (session.bluePlayer && session.redPlayer)) {
            session.spectators.push(socket.id);
            socket.join(roomId);
            socket.emit('init_game', { 
                roomId, role: 'spectator', 
                state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT 
            });
            return;
        }

        if (!session.redPlayer) {
            session.redPlayer = socket.id;
            session.redUserId = userId; 
            session.redName = nickname || 'Player 2';
            socket.join(roomId);
            socket.emit('init_game', { 
                roomId, role: 'red', 
                state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT 
            });
            io.to(roomId).emit('update_state', getPublicState(session));
        } 
    });

    // Переподключение
    socket.on('rejoin_game', ({ roomId, userId }) => {
        const session = sessions[roomId];
        if (!session) {
            socket.emit('error_msg', 'Session expired');
            return;
        }

        let role = 'spectator';
        if (session.blueUserId === userId) {
            session.bluePlayer = socket.id; 
            role = 'blue';
            session.lastActive = Date.now(); 
        } else if (session.redUserId === userId) {
            session.redPlayer = socket.id; 
            role = 'red';
            session.lastActive = Date.now(); 
        } else {
            session.spectators.push(socket.id);
        }

        socket.join(roomId);
        socket.emit('init_game', { 
            roomId, role, 
            state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT 
        });
        io.to(roomId).emit('update_state', getPublicState(session));
    });

    // Готовность и начало игры
    socket.on('player_ready', (roomId) => {
        const session = sessions[roomId];
        if (!session) return;
        session.lastActive = Date.now();

        if (socket.id === session.bluePlayer) session.ready.blue = true;
        if (socket.id === session.redPlayer) session.ready.red = true;

        io.to(roomId).emit('update_state', getPublicState(session));

        if (session.ready.blue && session.ready.red && !session.gameStarted) {
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

    // Пропуск хода (Skip)
    socket.on('skip_action', (roomId) => {
        const session = sessions[roomId];
        if (!session || !session.immunityPhaseActive) return;
        const isMyTurn = (session.currentTeam === 'blue' && socket.id === session.bluePlayer) ||
                         (session.currentTeam === 'red' && socket.id === session.redPlayer);
        if (!isMyTurn) return;

        if (session.currentAction === 'immunity_ban') {
            session.immunityBans.push('skipped');
        } else if (session.currentAction === 'immunity_pick') {
            session.immunityPool.push('skipped');
        }
        nextImmunityStep(roomId);
    });

    // Основное действие (Pick/Ban)
    socket.on('action', ({ roomId, charId }) => {
        const session = sessions[roomId];
        if (!session || !session.redPlayer || !session.gameStarted) return;
        const isMyTurn = (session.currentTeam === 'blue' && socket.id === session.bluePlayer) ||
                         (session.currentTeam === 'red' && socket.id === session.redPlayer);
        if (!isMyTurn) return;

        if (session.immunityPhaseActive) {
            if (session.immunityBans.includes(charId) || session.immunityPool.includes(charId)) return;
            if (session.currentAction === 'immunity_ban') session.immunityBans.push(charId);
            else session.immunityPool.push(charId);
            nextImmunityStep(roomId);
            return;
        }

        const config = session.draftOrder[session.stepIndex];
        if (session.currentAction === 'ban') {
            session.bans.push({ id: charId, team: session.currentTeam });
        } else {
            if (session.currentTeam === 'blue') session.bluePicks.push(charId);
            else session.redPicks.push(charId);
        }
        nextStep(roomId);
    });
});

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

function nextImmunityStep(roomId) {
    const session = sessions[roomId];
    session.immunityStepIndex++;
    session.timer = 45;
    if (session.immunityStepIndex >= IMMUNITY_ORDER.length) {
        session.immunityPhaseActive = false;
        session.stepIndex = 0;
        session.currentTeam = session.draftOrder[0].team;
        session.currentAction = session.draftOrder[0].type;
    } else {
        const config = IMMUNITY_ORDER[session.immunityStepIndex];
        session.currentTeam = config.team;
        session.currentAction = config.type;
    }
    io.to(roomId).emit('update_state', getPublicState(session));
}

function nextStep(roomId) {
    const session = sessions[roomId];
    session.stepIndex++;
    session.timer = 45;
    if (session.stepIndex >= session.draftOrder.length) {
        session.finishedAt = Date.now();
        io.to(roomId).emit('game_over', getPublicState(session));
        clearInterval(session.timerInterval);
        return;
    }
    const config = session.draftOrder[session.stepIndex];
    session.currentTeam = config.team;
    session.currentAction = config.type;
    io.to(roomId).emit('update_state', getPublicState(session));
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
                if (session.blueReserve <= 0) { session.blueReserve = 0; autoPick(roomId); }
            } else {
                session.redReserve--;
                if (session.redReserve <= 0) { session.redReserve = 0; autoPick(roomId); }
            }
        }
        io.to(roomId).emit('timer_tick', { main: session.timer, blueReserve: session.blueReserve, redReserve: session.redReserve });
    }, 1000);
}

function autoPick(roomId) {
    const session = sessions[roomId];
    let all = []; Object.values(CHARACTERS_BY_ELEMENT).forEach(a => all.push(...a));
    const randomChar = all.find(c => !session.bluePicks.includes(c.id) && !session.redPicks.includes(c.id));
    if (randomChar) {
        if (session.currentAction === 'ban') session.bans.push({ id: randomChar.id, team: session.currentTeam });
        else if (session.currentTeam === 'blue') session.bluePicks.push(randomChar.id);
        else session.redPicks.push(randomChar.id);
        nextStep(roomId);
    }
}

function getPublicState(session) {
    return {
        stepIndex: session.stepIndex + 1,
        currentTeam: session.currentTeam, 
        currentAction: session.currentAction,
        bans: session.bans, 
        bluePicks: session.bluePicks, 
        redPicks: session.redPicks,
        immunityPhaseActive: session.immunityPhaseActive,
        immunityPool: session.immunityPool,
        immunityBans: session.immunityBans,
        blueName: session.blueName, 
        redName: session.redName,
        draftType: session.draftType,
        ready: session.ready,
        gameStarted: session.gameStarted
    };
}

// Очистка старых сессий
setInterval(() => {
    const now = Date.now();
    Object.keys(sessions).forEach(id => {
        if (now - sessions[id].lastActive > 3600000) delete sessions[id];
    });
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
