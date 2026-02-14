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

// Подключаем существующие модели
const User = require('./models/User');
const Match = require('./models/Match');
// const GameSession = require('./models/GameSession'); // УБРАЛИ, так как файла нет

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Подключение к БД (нужно для User и Match, но не для активных игр теперь)
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB!');
        // restoreSessions(); // УБРАЛИ восстановление, так как не храним сессии в БД
    })
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

app.use(session({
    secret: 'gitcg-super-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

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

// Глобальный объект сессий (ВСЕ игры хранятся здесь, в оперативной памяти)
const sessions = {};

io.on('connection', (socket) => {
    socket.on('create_game', ({ nickname, draftType, userId, discordId, avatar }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const type = draftType || 'gitcg';
        
        sessions[roomId] = {
            id: roomId, roomId: roomId, 
            bluePlayer: socket.id, blueUserId: userId, 
            blueDiscordId: discordId, blueAvatar: avatar,
            redPlayer: null, redUserId: null, redDiscordId: null, redAvatar: null,
            spectators: [], blueName: nickname || 'Player 1', redName: 'Waiting...',
            draftType: type, draftOrder: DRAFT_RULES[type], gameStarted: false,
            immunityPhaseActive: false, immunityStepIndex: 0, immunityPool: [], immunityBans: [],
            lastActive: Date.now(), stepIndex: 0, currentTeam: null, currentAction: null,
            timer: 45, blueReserve: 180, redReserve: 180, timerInterval: null,
            bans: [], bluePicks: [], redPicks: [], ready: { blue: false, red: false }
        };
        
        // Нет await saveSession(roomId);

        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'blue', state: getPublicState(sessions[roomId]), chars: CHARACTERS_BY_ELEMENT });
    });

    // --- ЛОГИКА ВХОДА БЕЗ БД ---
    socket.on('join_game', ({roomId, nickname, userId, discordId, avatar}) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Room not found');
        
        session.lastActive = Date.now();

        // Если место Красного свободно
        if (!session.redPlayer) {
            session.redPlayer = socket.id; 
            session.redUserId = userId; 
            session.redName = nickname || 'Player 2';
            
            session.redDiscordId = discordId;
            session.redAvatar = avatar;
            
            // Нет await saveSession(roomId);
            
            socket.join(roomId); 
            socket.emit('init_game', { roomId, role: 'red', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
            io.to(roomId).emit('update_state', getPublicState(session));
        } 
        // Если занято -> в зрители
        else {
            if (!session.spectators.includes(socket.id)) {
                session.spectators.push(socket.id); 
            }
            
            socket.join(roomId);
            socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
        }
    });

    socket.on('rejoin_game', ({ roomId, userId, nickname }) => { 
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Session expired');
        
        let role = 'spectator';
        
        if (session.blueUserId === userId) { 
            session.bluePlayer = socket.id; 
            role = 'blue'; 
        } else if (session.redUserId === userId) { 
            session.redPlayer = socket.id; 
            role = 'red'; 
        } else if (!session.redUserId) {
            session.redUserId = userId;
            session.redPlayer = socket.id;
            session.redName = nickname || 'Player 2'; 
            role = 'red';
            io.to(roomId).emit('update_state', getPublicState(session));
        }

        socket.join(roomId);
        socket.emit('init_game', { roomId, role, state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
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

        if (session.currentAction === 'immunity_ban') {
            session.immunityBans.push('skipped');
        } else if (session.currentAction === 'immunity_pick') {
            session.immunityPool.push('skipped');
        }
        
        nextImmunityStep(roomId);
    });

    socket.on('action', ({ roomId, charId }) => {
        const session = sessions[roomId];
        if (!session || !session.redPlayer || !session.gameStarted) return;

        session.lastActive = Date.now();

        const isBlueTurn = session.currentTeam === 'blue' && socket.id === session.bluePlayer;
        const isRedTurn = session.currentTeam === 'red' && socket.id === session.redPlayer;
        
        if (!isBlueTurn && !isRedTurn) return;

        // --- ЛОГИКА ИММУНИТЕТА ---
        if (session.immunityPhaseActive) {
            const isImmunityBanned = session.immunityBans.includes(charId);
            const isImmunityPicked = session.immunityPool.includes(charId);
            if (isImmunityBanned || isImmunityPicked) return;

            if (session.currentAction === 'immunity_ban') {
                session.immunityBans.push(charId);
            } else if (session.currentAction === 'immunity_pick') {
                session.immunityPool.push(charId);
            }
            nextImmunityStep(roomId);
            return;
        }

        // --- ОБЫЧНАЯ ЛОГИКА ---
        const currentConfig = session.draftOrder[session.stepIndex];
        const isImmunityTurn = !!currentConfig.immunity;

        const isGlobalBanned = session.bans.some(b => b.id === charId);
        const isPickedByBlue = session.bluePicks.includes(charId);
        const isPickedByRed = session.redPicks.includes(charId);
        const isInImmunityPool = session.immunityPool.filter(id => id !== 'skipped').includes(charId);

        if (isGlobalBanned) return;
        if (session.currentTeam === 'blue' && isPickedByBlue) return;
        if (session.currentTeam === 'red' && isPickedByRed) return;

        if (isInImmunityPool) {
            if (session.currentAction === 'ban') return;
            if (session.currentAction === 'pick' && !isImmunityTurn) return;
        }

        let isAvailable = !isPickedByBlue && !isPickedByRed;
        if (isImmunityTurn && isInImmunityPool) {
            isAvailable = true; 
        }

        if (!isAvailable) return;

        if (session.currentAction === 'ban') {
            session.bans.push({ id: charId, team: session.currentTeam });
        } else {
            if (session.currentTeam === 'blue') session.bluePicks.push(charId);
            else session.redPicks.push(charId);
        }

        nextStep(roomId);
    });
});

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

async function nextStep(roomId) {
    const s = sessions[roomId]; s.stepIndex++; s.timer = 45;
    
    if (s.stepIndex >= s.draftOrder.length) {
        io.to(roomId).emit('game_over', getPublicState(s)); 
        clearInterval(s.timerInterval); 
        try {
            // Сохраняем ИСТОРИЮ (это работает, так как модель Match есть)
            await Match.create({
                roomId: s.id, draftType: s.draftType, blueName: s.blueName, redName: s.redName,
                blueDiscordId: s.blueDiscordId, redDiscordId: s.redDiscordId,
                blueAvatar: s.blueAvatar, redAvatar: s.redAvatar, 
                bans: s.bans, bluePicks: s.bluePicks, redPicks: s.redPicks,
                immunityPool: s.immunityPool, immunityBans: s.immunityBans
            });
            
            delete sessions[roomId]; // Удаляем из памяти

            const count = await Match.countDocuments();
            if (count > 6) {
                const oldOnes = await Match.find().sort({ date: 1 }).limit(count - 6);
                await Match.deleteMany({ _id: { $in: oldOnes.map(m => m._id) } });
            }
        } catch (e) { console.error(e); }
        return;
    }
    const c = s.draftOrder[s.stepIndex]; s.currentTeam = c.team; s.currentAction = c.type;
    io.to(roomId).emit('update_state', getPublicState(s));
}

function startTimer(roomId) {
    const s = sessions[roomId];
    if (s.timerInterval) clearInterval(s.timerInterval);
    s.timerInterval = setInterval(() => {
        if (!sessions[roomId]) return clearInterval(s.timerInterval);

        if (s.timer > 0) s.timer--;
        else {
            if (s.currentTeam === 'blue') s.blueReserve--;
            else s.redReserve--;
        }
        io.to(roomId).emit('timer_tick', { main: s.timer, blueReserve: s.blueReserve, redReserve: s.redReserve });
    }, 1000);
}

function getPublicState(session) {
    if (!session) return {};
    return {
        stepIndex: session.stepIndex + 1,
        currentTeam: session.currentTeam, currentAction: session.currentAction,
        bans: session.bans, bluePicks: session.bluePicks, redPicks: session.redPicks,
        blueName: session.blueName, redName: session.redName, draftType: session.draftType,
        blueDiscordId: session.blueDiscordId, redDiscordId: session.redDiscordId, 
        blueAvatar: session.blueAvatar, redAvatar: session.redAvatar,             
        
        immunityPhaseActive: session.immunityPhaseActive,
        immunityPool: session.immunityPool || [],
        immunityBans: session.immunityBans || [],

        ready: session.ready, gameStarted: session.gameStarted
    };
}

const PORT = process.env.PORT || 3000;

// --- GARBAGE COLLECTOR (Очистка памяти) ---
setInterval(() => {
    const now = Date.now();
    let deletedCount = 0;
    for (const roomId in sessions) {
        const session = sessions[roomId];
        // Если комната неактивна более 2 часов
        if (now - session.lastActive > 7200000) {
            if (session.timerInterval) clearInterval(session.timerInterval);
            delete sessions[roomId]; // Удаляем из памяти
            deletedCount++;
        }
    }
    if (deletedCount > 0) console.log(`[GC] Очищено комнат: ${deletedCount}. Активных: ${Object.keys(sessions).length}`);
}, 1800000);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
