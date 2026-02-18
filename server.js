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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB!'))
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

const sessions = {};

io.on('connection', (socket) => {
    socket.on('create_game', ({ nickname, draftType, userId, discordId, avatar }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const type = draftType || 'gitcg';
        sessions[roomId] = {
            id: roomId, bluePlayer: socket.id, blueUserId: userId, 
            blueDiscordId: discordId, blueAvatar: avatar,
            redPlayer: null, redUserId: null, redDiscordId: null, redAvatar: null,
            spectators: [], blueName: nickname || 'Player 1', redName: 'Waiting...',
            draftType: type, draftOrder: DRAFT_RULES[type], gameStarted: false,
            immunityPhaseActive: false, immunityStepIndex: 0, immunityPool: [], immunityBans: [],
            lastActive: Date.now(), stepIndex: 0, currentTeam: null, currentAction: null,
            timer: 45, blueReserve: 180, redReserve: 180, timerInterval: null,
            bans: [], bluePicks: [], redPicks: [], ready: { blue: false, red: false },
            
            // --- ЛОГИКА POST-MATCH ---
            draftFinished: false,
            blueDecks: Array(9).fill(null), // 3 игры * 3 чара
            redDecks: Array(9).fill(null),
            gameResults: [null, null, null], // Кто выиграл Game 1, 2, 3
            matchSaved: false
        };
        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'blue', state: getPublicState(sessions[roomId]), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('join_game', ({roomId, nickname, asSpectator, userId}) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Room not found');
        if (!session.redPlayer && !asSpectator) {
            session.redPlayer = socket.id; session.redUserId = userId; session.redName = nickname || 'Player 2';
            socket.join(roomId); socket.emit('init_game', { roomId, role: 'red', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
            io.to(roomId).emit('update_state', getPublicState(session));
        } else {
            session.spectators.push(socket.id); socket.join(roomId);
            socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
        }
    });

    socket.on('rejoin_game', ({ roomId, userId, nickname, discordId, avatar }) => { 
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Session expired');
        
        let role = 'spectator';
        if (session.blueUserId === userId) { 
            session.bluePlayer = socket.id; 
            session.blueDiscordId = discordId || session.blueDiscordId; 
            session.blueAvatar = avatar || session.blueAvatar; 
            role = 'blue'; 
        } else if (session.redUserId === userId) { 
            session.redPlayer = socket.id; 
            session.redDiscordId = discordId || session.redDiscordId; 
            session.redAvatar = avatar || session.redAvatar; 
            role = 'red'; 
        } else if (!session.redUserId) {
            session.redUserId = userId; session.redPlayer = socket.id;
            session.redName = nickname || 'Player 2'; 
            session.redDiscordId = discordId; session.redAvatar = avatar; 
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

    // --- ОБНОВЛЕНИЕ СЛОТА В ДЕКЕ ---
    socket.on('update_deck_slot', ({ roomId, slotIndex, charId }) => {
        const s = sessions[roomId];
        if (!s || !s.draftFinished || s.matchSaved) return;
        s.lastActive = Date.now();

        if (socket.id === s.bluePlayer) {
            if (s.bluePicks.includes(charId) || charId === null) s.blueDecks[slotIndex] = charId;
        } else if (socket.id === s.redPlayer) {
            if (s.redPicks.includes(charId) || charId === null) s.redDecks[slotIndex] = charId;
        }
        io.to(roomId).emit('update_state', getPublicState(s));
    });

    // --- ВЫБОР ПОБЕДИТЕЛЯ ИГРЫ ---
    socket.on('update_game_winner', ({ roomId, gameIndex, winner }) => {
        const s = sessions[roomId];
        if (!s || !s.draftFinished || s.matchSaved) return;
        
        // Любой игрок может кликнуть (или можно ограничить). Сейчас разрешим обоим для удобства.
        if (socket.id === s.bluePlayer || socket.id === s.redPlayer) {
            s.gameResults[gameIndex] = winner; // 'blue' или 'red' или null
            io.to(roomId).emit('update_state', getPublicState(s));
        }
    });

    // --- ЗАВЕРШЕНИЕ И СОХРАНЕНИЕ ---
    socket.on('finish_match_setup', async ({ roomId }) => {
        const s = sessions[roomId];
        if (!s || !s.draftFinished || s.matchSaved) return;

        if (socket.id === s.bluePlayer || socket.id === s.redPlayer) {
            s.matchSaved = true; 
            
            // Считаем счет
            const blueWins = s.gameResults.filter(w => w === 'blue').length;
            const redWins = s.gameResults.filter(w => w === 'red').length;

            try {
                await Match.create({
                    roomId: s.id, draftType: s.draftType, blueName: s.blueName, redName: s.redName,
                    blueDiscordId: s.blueDiscordId, redDiscordId: s.redDiscordId,
                    blueAvatar: s.blueAvatar, redAvatar: s.redAvatar, 
                    bans: s.bans, bluePicks: s.bluePicks, redPicks: s.redPicks,
                    immunityPool: s.immunityPool, immunityBans: s.immunityBans,
                    
                    // Сохраняем новые данные
                    blueDecks: s.blueDecks,
                    redDecks: s.redDecks,
                    gameResults: s.gameResults,
                    score: { blue: blueWins, red: redWins }
                });

                if (s.blueDiscordId) await User.updateOne({ discordId: s.blueDiscordId }, { $inc: { gamesPlayed: 1 } });
                if (s.redDiscordId) await User.updateOne({ discordId: s.redDiscordId }, { $inc: { gamesPlayed: 1 } });

                // Чистка
                const count = await Match.countDocuments();
                if (count > 50) {
                    const oldOnes = await Match.find().sort({ date: 1 }).limit(count - 50);
                    await Match.deleteMany({ _id: { $in: oldOnes.map(m => m._id) } });
                }

                io.to(roomId).emit('match_saved_success');
            } catch (e) { console.error(e); }
        }
    });

    socket.on('skip_action', (roomId) => { /* ... (старый код без изменений) ... */ 
        const session = sessions[roomId]; if(!session) return;
        if(session.immunityPhaseActive) {
             // ... логика иммунитета ...
             session.lastActive = Date.now();
             if (session.currentAction === 'immunity_ban') session.immunityBans.push('skipped');
             else session.immunityPool.push('skipped');
             nextImmunityStep(roomId);
        }
    });

    socket.on('action', ({ roomId, charId }) => {
        const session = sessions[roomId];
        if (!session || !session.redPlayer || !session.gameStarted || session.draftFinished) return;

        session.lastActive = Date.now();
        
        // Проверка хода
        const isBlue = session.currentTeam === 'blue';
        if ((isBlue && socket.id !== session.bluePlayer) || (!isBlue && socket.id !== session.redPlayer)) return;

        // --- ФАЗА ИММУНИТЕТА ---
        if (session.immunityPhaseActive) {
            if (session.immunityBans.includes(charId) || session.immunityPool.includes(charId)) return;
            
            if (session.currentAction === 'immunity_ban') session.immunityBans.push(charId);
            else session.immunityPool.push(charId);
            
            nextImmunityStep(roomId);
            return;
        }

        // --- ОБЫЧНЫЙ ДРАФТ ---
        
        // 1. Проверка Глобального Бана
        const isGlobalBanned = session.bans.some(b => b.id === charId);
        if (isGlobalBanned) return;

        // 2. Проверка: Я уже взял этого чара? (Нельзя брать дубликатов себе)
        const iHaveIt = isBlue ? session.bluePicks.includes(charId) : session.redPicks.includes(charId);
        if (iHaveIt) return;

        // 3. Проверка: Враг взял этого чара?
        const enemyHasIt = isBlue ? session.redPicks.includes(charId) : session.bluePicks.includes(charId);
        
        // 4. Проверка: Чар в иммунитете? (Игнорируем "скипнутые" слоты)
        const isImmune = session.immunityPool.filter(id => id !== 'skipped').includes(charId);

        // ГЛАВНОЕ ПРАВИЛО: 
        // Если враг взял чара, я могу его взять ТОЛЬКО если он в иммунитете.
        if (enemyHasIt && !isImmune) return;

        // Если это бан-фаза
        if (session.currentAction === 'ban') {
            // Нельзя банить иммунных (если правила это подразумевают, обычно иммунных банить нельзя)
            if (isImmune) return;
            session.bans.push({ id: charId, team: session.currentTeam });
        } 
        // Если это пик-фаза
        else {
            if (isBlue) session.bluePicks.push(charId);
            else session.redPicks.push(charId);
        }
        
        nextStep(roomId);
    });

// ... (функции nextImmunityStep, startTimer без изменений) ...
function nextImmunityStep(roomId) {
    const s = sessions[roomId]; s.immunityStepIndex++; s.timer = 45;
    if (s.immunityStepIndex >= IMMUNITY_ORDER.length) {
        s.immunityPhaseActive = false; s.stepIndex = 0;
        s.currentTeam = s.draftOrder[0].team; s.currentAction = s.draftOrder[0].type;
    } else {
        const c = IMMUNITY_ORDER[s.immunityStepIndex]; s.currentTeam = c.team; s.currentAction = c.type;
    }
    io.to(roomId).emit('update_state', getPublicState(s));
}

function nextStep(roomId) {
    const s = sessions[roomId]; s.stepIndex++; s.timer = 45;
    
    // --- ПРОВЕРКА КОНЦА ДРАФТА ---
    if (s.stepIndex >= s.draftOrder.length) {
        clearInterval(s.timerInterval);
        
        // Включаем пост-матч ТОЛЬКО для нужных режимов
        if (s.draftType === 'gitcg' || s.draftType === 'gitcg_cup_2') {
            s.draftFinished = true;
            io.to(roomId).emit('update_state', getPublicState(s));
        } else {
            // Для остальных режимов сразу сохраняем (как было раньше)
            saveMatchImmediately(s);
        }
        return;
    }

    const c = s.draftOrder[s.stepIndex]; s.currentTeam = c.team; s.currentAction = c.type;
    io.to(roomId).emit('update_state', getPublicState(s));
}

async function saveMatchImmediately(s) {
    io.to(s.id).emit('game_over', getPublicState(s)); 
    try {
        await Match.create({
            roomId: s.id, draftType: s.draftType, blueName: s.blueName, redName: s.redName,
            blueDiscordId: s.blueDiscordId, redDiscordId: s.redDiscordId,
            blueAvatar: s.blueAvatar, redAvatar: s.redAvatar, 
            bans: s.bans, bluePicks: s.bluePicks, redPicks: s.redPicks,
            immunityPool: s.immunityPool, immunityBans: s.immunityBans
        });
        // +1 игра и очистка (как обычно)
    } catch (e) { console.error(e); }
}

function startTimer(roomId) {
    const s = sessions[roomId]; if (s.timerInterval) clearInterval(s.timerInterval);
    s.timerInterval = setInterval(() => {
        if (s.timer > 0) s.timer--;
        else {
            if (s.currentTeam === 'blue') s.blueReserve--; else s.redReserve--;
        }
        io.to(roomId).emit('timer_tick', { main: s.timer, blueReserve: s.blueReserve, redReserve: s.redReserve });
    }, 1000);
}

function getPublicState(session) {
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
        
        // Новые данные
        draftFinished: session.draftFinished,
        blueDecks: session.blueDecks,
        redDecks: session.redDecks,
        gameResults: session.gameResults,
        matchSaved: session.matchSaved,

        ready: session.ready, gameStarted: session.gameStarted
    };
}

const PORT = process.env.PORT || 3000;
setInterval(() => { /* GC */ }, 1800000);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
