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

// Подключение к БД
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

app.use(session({
    secret: process.env.SESSION_SECRET || 'gitcg-super-secret-key',
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
const { DRAFT_RULES } = require('./public/draft-rules.js');

const indexRouter = require('./routes/index');
app.use('/', indexRouter);

const sessions = {};

io.on('connection', (socket) => {
    socket.on('create_game', ({ nickname, draftType, userId }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const type = draftType || 'gitcg';
        sessions[roomId] = {
            id: roomId, bluePlayer: socket.id, blueUserId: userId, redPlayer: null, redUserId: null,
            spectators: [], blueName: nickname || 'Player 1', redName: 'Waiting...',
            draftType: type, draftOrder: DRAFT_RULES[type], gameStarted: false,
            lastActive: Date.now(), stepIndex: 0, currentTeam: null, currentAction: null,
            timer: 45, blueReserve: 180, redReserve: 180, timerInterval: null,
            bans: [], bluePicks: [], redPicks: [], ready: { blue: false, red: false },
            // --- НОВОЕ: Данные для пост-матча ---
            postGameActive: false,
            matchResults: [
                { id: 1, blueChar: null, redChar: null, winner: null },
                { id: 2, blueChar: null, redChar: null, winner: null },
                { id: 3, blueChar: null, redChar: null, winner: null }
            ],
            finalScore: { blue: 0, red: 0 }
        };
        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'blue', state: getPublicState(sessions[roomId]), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('join_game', ({roomId, nickname, asSpectator, userId}) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Room not found');

        // Логика реконнекта (Важно для стабильности!)
        if (session.blueUserId === userId) {
            session.bluePlayer = socket.id;
            socket.join(roomId);
            return socket.emit('init_game', { roomId, role: 'blue', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
        }
        if (session.redUserId === userId) {
            session.redPlayer = socket.id;
            socket.join(roomId);
            return socket.emit('init_game', { roomId, role: 'red', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
        }

        if (!session.redPlayer && !asSpectator) {
            session.redPlayer = socket.id; session.redUserId = userId; session.redName = nickname || 'Player 2';
            socket.join(roomId); socket.emit('init_game', { roomId, role: 'red', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
            io.to(roomId).emit('update_state', getPublicState(session));
        } else {
            session.spectators.push(socket.id); socket.join(roomId);
            socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
        }
    });

    socket.on('player_ready', (roomId) => {
        const session = sessions[roomId];
        if (!session) return;
        if (socket.id === session.bluePlayer) session.ready.blue = true;
        if (socket.id === session.redPlayer) session.ready.red = true;
        io.to(roomId).emit('update_state', getPublicState(session));
        if (session.ready.blue && session.ready.red && !session.gameStarted) {
            session.gameStarted = true;
            session.currentTeam = session.draftOrder[0].team; session.currentAction = session.draftOrder[0].type;
            startTimer(roomId); io.to(roomId).emit('game_started'); io.to(roomId).emit('update_state', getPublicState(session));
        }
    });

    socket.on('action', ({ roomId, charId }) => {
        const session = sessions[roomId];
        if (!session || !session.gameStarted) return;
        if (session.currentAction === 'ban') session.bans.push({ id: charId, team: session.currentTeam });
        else session.currentTeam === 'blue' ? session.bluePicks.push(charId) : session.redPicks.push(charId);
        nextStep(roomId);
    });
    
    socket.on('skip_action', (roomId) => {
        const session = sessions[roomId];
        if (!session || !session.gameStarted) return;
        nextStep(roomId);
    });

    // --- НОВОЕ: Обработка изменений в таблице результатов ---
    socket.on('update_match_result', ({ roomId, gameIndex, field, value }) => {
        const session = sessions[roomId];
        if (!session || !session.postGameActive) return;

        // Обновляем данные матча
        if (session.matchResults[gameIndex]) {
            session.matchResults[gameIndex][field] = value;
        }

        // Пересчет счета
        let b = 0, r = 0;
        session.matchResults.forEach(m => {
            if (m.winner === 'blue') b++;
            if (m.winner === 'red') r++;
        });
        session.finalScore = { blue: b, red: r };

        io.to(roomId).emit('update_state', getPublicState(session));
    });
});

async function nextStep(roomId) {
    const s = sessions[roomId]; s.stepIndex++; s.timer = 45;
    if (s.stepIndex >= s.draftOrder.length) {
        clearInterval(s.timerInterval);
        
        // Вместо game_over просто активируем пост-гейм фазу
        s.gameStarted = false;
        s.postGameActive = true;
        
        io.to(roomId).emit('update_state', getPublicState(s));
        
        // Сохраняем в БД (можно и позже, после заполнения, но для надежности сохраним драфт сейчас)
        try {
            await Match.create({
                roomId: s.id, draftType: s.draftType, blueName: s.blueName, redName: s.redName,
                blueDiscordId: s.blueUserId, redDiscordId: s.redUserId,
                bans: s.bans, bluePicks: s.bluePicks, redPicks: s.redPicks
            });
            // Очистка старых матчей
            const count = await Match.countDocuments();
            if (count > 20) {
                const oldOnes = await Match.find().sort({ date: 1 }).limit(count - 20);
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
        if (s.timer > 0) s.timer--;
        else {
            if (s.currentTeam === 'blue') s.blueReserve--;
            else s.redReserve--;
        }
        io.to(roomId).emit('timer_tick', { main: s.timer, blueReserve: s.blueReserve, redReserve: s.redReserve });
    }, 1000);
}

function getPublicState(session) {
    // --- ЛОГИКА ИММУНИТЕТА НАЧАЛО ---
    let immunityPool = [];
    let immunityBans = [];
    
    // Нам нужно пройтись по истории шагов, чтобы понять, какие пики/баны были "иммунными"
    let banCount = 0;
    let bluePickCount = 0;
    let redPickCount = 0;

    // Проходим по всем шагам, которые уже случились (до текущего stepIndex)
    for (let i = 0; i < session.stepIndex; i++) {
        const step = session.draftOrder[i];
        if (!step) break;

        if (step.type === 'ban') {
            // Если это был шаг бана, берем соответствующий бан из массива bans
            if (banCount < session.bans.length) {
                const ban = session.bans[banCount];
                if (step.immunity) {
                    immunityBans.push(ban.id);
                }
                banCount++;
            }
        } else if (step.type === 'pick') {
            // Если это был шаг пика, берем персонажа из массива пиков соответствующей команды
            if (step.team === 'blue') {
                if (bluePickCount < session.bluePicks.length) {
                    const pick = session.bluePicks[bluePickCount];
                    if (step.immunity) {
                        immunityPool.push(pick);
                    }
                    bluePickCount++;
                }
            } else if (step.team === 'red') {
                if (redPickCount < session.redPicks.length) {
                    const pick = session.redPicks[redPickCount];
                    if (step.immunity) {
                        immunityPool.push(pick);
                    }
                    redPickCount++;
                }
            }
        }
    }
    // --- ЛОГИКА ИММУНИТЕТА КОНЕЦ ---

    return {
        stepIndex: session.stepIndex + 1,
        currentTeam: session.currentTeam, 
        currentAction: session.currentAction,
        bans: session.bans, 
        bluePicks: session.bluePicks, 
        redPicks: session.redPicks,
        blueName: session.blueName, 
        redName: session.redName, 
        draftType: session.draftType,
        ready: session.ready, 
        gameStarted: session.gameStarted,
        
        // Определяем, активна ли фаза иммунитета ПРЯМО СЕЙЧАС (для заголовка)
        immunityPhaseActive: (session.draftOrder[session.stepIndex] && session.draftOrder[session.stepIndex].immunity),
        
        // Теперь отправляем правильные списки
        immunityBans: immunityBans,
        immunityPool: immunityPool, 
        
        // Новые поля для пост-гейма
        postGameActive: session.postGameActive,
        matchResults: session.matchResults,
        finalScore: session.finalScore
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
