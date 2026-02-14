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

const User = require('./models/User');
const Match = require('./models/Match');
const GameSession = require('./models/GameSession'); // - по аналогии подключаем новую модель

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB!');
        restoreSessions(); // Восстанавливаем игры после перезапуска
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

// Глобальный объект сессий (для быстродействия), синхронизируется с БД
const sessions = {};

// Функция восстановления сессий из базы данных при старте сервера
async function restoreSessions() {
    try {
        const storedSessions = await GameSession.find({});
        storedSessions.forEach(doc => {
            const s = doc.toObject();
            sessions[s.roomId] = s;
            // Перезапускаем таймер, если игра была активна
            if (s.gameStarted) {
                startTimer(s.roomId);
            }
        });
        if (storedSessions.length > 0) {
            console.log(`🔄 Restored ${storedSessions.length} active games from Database.`);
        }
    } catch (e) {
        console.error("Failed to restore sessions:", e);
    }
}

// Вспомогательная функция для сохранения состояния в БД
async function saveSession(roomId) {
    if (!sessions[roomId]) return;
    try {
        // Удаляем поле timerInterval перед сохранением, так как MongoDB не умеет хранить таймеры
        const { timerInterval, ...sessionData } = sessions[roomId];
        await GameSession.findOneAndUpdate(
            { roomId: roomId },
            sessionData,
            { upsert: true, new: true }
        );
    } catch (e) {
        console.error(`Error saving session ${roomId}:`, e);
    }
}

io.on('connection', (socket) => {
    socket.on('create_game', async ({ nickname, draftType, userId, discordId, avatar }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const type = draftType || 'gitcg';
        sessions[roomId] = {
            id: roomId, roomId: roomId, // Дублируем для удобства
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
        
        await saveSession(roomId); // СОХРАНЯЕМ В БД

        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'blue', state: getPublicState(sessions[roomId]), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('join_game', async ({roomId, nickname, asSpectator, userId}) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Room not found');
        
        if (!session.redPlayer && !asSpectator) {
            session.redPlayer = socket.id; session.redUserId = userId; session.redName = nickname || 'Player 2';
            
            await saveSession(roomId); // СОХРАНЯЕМ В БД
            
            socket.join(roomId); socket.emit('init_game', { roomId, role: 'red', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
            io.to(roomId).emit('update_state', getPublicState(session));
        } else {
            session.spectators.push(socket.id); 
            await saveSession(roomId); // СОХРАНЯЕМ В БД
            
            socket.join(roomId);
            socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
        }
    });

    socket.on('rejoin_game', ({ roomId, userId, nickname }) => { 
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Session expired');
        
        let role = 'spectator';
        
        // Обновляем socket.id при переподключении
        if (session.blueUserId === userId) { 
            session.bluePlayer = socket.id; 
            role = 'blue'; 
        } else if (session.redUserId === userId) { 
            session.redPlayer = socket.id; 
            role = 'red'; 
        } else if (!session.redUserId) {
            // Если игрок был создан, но еще не зашел (редкий кейс, но на всякий случай)
            session.redUserId = userId;
            session.redPlayer = socket.id;
            session.redName = nickname || 'Player 2'; 
            role = 'red';
            io.to(roomId).emit('update_state', getPublicState(session));
        }

        // Тут сохранять в БД не обязательно каждую секунду, socket.id динамический
        socket.join(roomId);
        socket.emit('init_game', { roomId, role, state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('player_ready', async (roomId) => {
        const session = sessions[roomId];
        if (!session) return;
        if (socket.id === session.bluePlayer) session.ready.blue = true;
        if (socket.id === session.redPlayer) session.ready.red = true;
        
        await saveSession(roomId); // СОХРАНЯЕМ

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
            
            await saveSession(roomId); // СОХРАНЯЕМ СТАРТ

            io.to(roomId).emit('game_started'); 
            io.to(roomId).emit('update_state', getPublicState(session));
        }
    });

    socket.on('skip_action', async (roomId) => {
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
        
        await saveSession(roomId); // СОХРАНЯЕМ
        nextImmunityStep(roomId);
    });

    socket.on('action', async ({ roomId, charId }) => {
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
            await saveSession(roomId); // СОХРАНЯЕМ
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

        await saveSession(roomId); // СОХРАНЯЕМ
        nextStep(roomId);
    });
});

async function nextImmunityStep(roomId) {
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
    await saveSession(roomId); // Сохраняем смену этапа
    io.to(roomId).emit('update_state', getPublicState(session));
}

async function nextStep(roomId) {
    const s = sessions[roomId]; s.stepIndex++; s.timer = 45;
    
    if (s.stepIndex >= s.draftOrder.length) {
        io.to(roomId).emit('game_over', getPublicState(s)); 
        clearInterval(s.timerInterval); 
        try {
            // Сохраняем в историю
            await Match.create({
                roomId: s.id, draftType: s.draftType, blueName: s.blueName, redName: s.redName,
                blueDiscordId: s.blueDiscordId, redDiscordId: s.redDiscordId,
                blueAvatar: s.blueAvatar, redAvatar: s.redAvatar, 
                bans: s.bans, bluePicks: s.bluePicks, redPicks: s.redPicks,
                immunityPool: s.immunityPool, immunityBans: s.immunityBans
            });
            // Удаляем активную сессию из БД, так как игра окончена
            await GameSession.deleteOne({ roomId: s.roomId });
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
    await saveSession(roomId); // Сохраняем смену хода
    io.to(roomId).emit('update_state', getPublicState(s));
}

function startTimer(roomId) {
    const s = sessions[roomId];
    if (s.timerInterval) clearInterval(s.timerInterval);
    s.timerInterval = setInterval(() => {
        if (!sessions[roomId]) return clearInterval(s.timerInterval); // Защита от краша

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

// --- GARBAGE COLLECTOR (Очистка неактивных комнат) ---
setInterval(async () => {
    const now = Date.now();
    let deletedCount = 0;
    for (const roomId in sessions) {
        const session = sessions[roomId];
        // Если комната неактивна более 2 часов
        if (now - session.lastActive > 7200000) {
            if (session.timerInterval) clearInterval(session.timerInterval);
            delete sessions[roomId]; // Удаляем из памяти
            await GameSession.deleteOne({ roomId: roomId }); // Удаляем из БД
            deletedCount++;
        }
    }
    if (deletedCount > 0) console.log(`[GC] Очищено комнат: ${deletedCount}. Активных: ${Object.keys(sessions).length}`);
}, 1800000);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
