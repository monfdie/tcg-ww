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
const Tournament = require('./models/Tournament');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 1. DB CONNECT ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 2. MIDDLEWARE ---
app.use(session({
    secret: 'gitcg-super-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

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

// --- ФУНКЦИИ ДЛЯ CHAOS DRAFT ---
function shuffleArray(array) {
    let arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function generateChaosPool() {
    let pool = { cryo: [], hydro: [], pyro: [], electro: [], anemo: [], geo: [], dendro: [] };
    let remainingToPickFrom = [];
    
    // 1. Берем по 5 случайных из каждой стихии (5 * 7 = 35)
    for (let element in CHARACTERS_BY_ELEMENT) {
        let shuffled = shuffleArray(CHARACTERS_BY_ELEMENT[element]);
        pool[element] = shuffled.slice(0, 4); // Гарантированные 5
        
        // Остальных скидываем в общую "корзину" для добора
        let leftovers = shuffled.slice(5).map(c => ({ ...c, element }));
        remainingToPickFrom = remainingToPickFrom.concat(leftovers);
    }
    
    // 2. Перемешиваем общую корзину и берем оставшиеся 11 персонажей (35 + 11 = 46)
    remainingToPickFrom = shuffleArray(remainingToPickFrom);
    let extraChars = remainingToPickFrom.slice(0, 7);
    
    // 3. Раскидываем эти 11 случайных персонажей обратно по их стихиям в пуле
    extraChars.forEach(c => {
        const charData = { id: c.id, name: c.name, img: c.img };
        pool[c.element].push(charData);
    });
    
    return pool;
}
// ---------------------------------

const indexRouter = require('./routes/index');
app.use('/', indexRouter);

const sessions = {};

// --- 3. SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    
    socket.on('create_game', ({ nickname, draftType, userId, discordId, avatar }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const type = draftType || 'gitcg';
        // Если это хаос, временно берем правила от classic, чтобы игра не крашилась
        const orderType = type === 'chaos' ? 'classic' : type; 
        
        sessions[roomId] = {
            id: roomId, 
            bluePlayer: null, blueUserId: null, blueDiscordId: null, blueAvatar: null, blueBox: [],
            redPlayer: null, redUserId: null, redDiscordId: null, redAvatar: null, redBox: [],
            spectators: [socket.id], blueName: 'Waiting...', redName: 'Waiting...',
            draftType: type, draftOrder: DRAFT_RULES[orderType], gameStarted: false,
            immunityPhaseActive: false, immunityStepIndex: 0, immunityPool: [], immunityBans: [],
            lastActive: Date.now(), stepIndex: 0, currentTeam: null, currentAction: null,
            timer: 45, blueReserve: 180, redReserve: 180, timerInterval: null,
            bans: [], bluePicks: [], redPicks: [], ready: { blue: false, red: false },
            draftFinished: false, finishedAt: null
        };

        if (type === 'chaos') {
            sessions[roomId].chaosPool = generateChaosPool();
        }

        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(sessions[roomId]), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('join_game', ({roomId}) => {
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Room not found');
        
        session.lastActive = Date.now();
        session.spectators.push(socket.id);
        socket.join(roomId);
        socket.emit('init_game', { roomId, role: 'spectator', state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('rejoin_game', ({ roomId, userId, nickname, discordId, avatar }) => { 
        const session = sessions[roomId];
        if (!session) return socket.emit('error_msg', 'Session expired');
        
        session.lastActive = Date.now();
        let role = 'spectator';
        
        if (session.blueUserId === userId) { 
            session.bluePlayer = socket.id; session.blueDiscordId = discordId || session.blueDiscordId; session.blueAvatar = avatar || session.blueAvatar; role = 'blue'; 
        } else if (session.redUserId === userId) { 
            session.redPlayer = socket.id; session.redDiscordId = discordId || session.redDiscordId; session.redAvatar = avatar || session.redAvatar; role = 'red'; 
        } else {
            session.spectators.push(socket.id);
        }
        
        socket.join(roomId);
        socket.emit('init_game', { roomId, role, state: getPublicState(session), chars: CHARACTERS_BY_ELEMENT });
    });

    socket.on('take_seat', async ({ roomId, userId, side, nickname, discordId, avatar }) => {
        const session = sessions[roomId];
        if (!session || session.gameStarted) return;

        let userBox = [];
        if (session.draftType === 'abyss_box') {
            try {
                const userDb = await User.findOne({ discordId: discordId });
                let activeBox = [];
                if (userDb && userDb.boxes && userDb.boxes.length > 0) {
                    const idx = userDb.activeBoxIndex || 0;
                    activeBox = userDb.boxes[idx]?.characters || [];
                } else if (userDb && userDb.box) {
                    activeBox = userDb.box;
                }
                
                if (!activeBox || activeBox.length === 0) {
                    socket.emit('error_msg', 'You must assemble an Abyss Box in your Profile first!');
                    return;
                }
                userBox = activeBox;
            } catch (e) {
                console.error(e);
                socket.emit('error_msg', 'Database error loading your box.');
                return;
            }
        }

        if (session.blueUserId === userId) { 
            session.blueUserId = null; session.bluePlayer = null; session.blueName = 'Waiting...'; session.ready.blue = false; session.blueBox = [];
        }
        if (session.redUserId === userId) { 
            session.redUserId = null; session.redPlayer = null; session.redName = 'Waiting...'; session.ready.red = false; session.redBox = [];
        }

        if (side === 'blue' && !session.blueUserId) {
            session.blueUserId = userId; session.bluePlayer = socket.id; 
            session.blueName = nickname || 'Player 1'; session.blueDiscordId = discordId; session.blueAvatar = avatar;
            if (session.draftType === 'abyss_box') session.blueBox = userBox;
            io.to(socket.id).emit('role_update', 'blue');
        } else if (side === 'red' && !session.redUserId) {
            session.redUserId = userId; session.redPlayer = socket.id; 
            session.redName = nickname || 'Player 2'; session.redDiscordId = discordId; session.redAvatar = avatar;
            if (session.draftType === 'abyss_box') session.redBox = userBox;
            io.to(socket.id).emit('role_update', 'red');
        }

        io.to(roomId).emit('update_state', getPublicState(session));
    });

    socket.on('leave_seat', ({ roomId, userId }) => {
        const session = sessions[roomId];
        if (!session || session.gameStarted) return;

        if (session.blueUserId === userId) { 
            session.blueUserId = null; session.bluePlayer = null; session.blueName = 'Waiting...'; session.ready.blue = false; session.blueBox = [];
        }
        if (session.redUserId === userId) { 
            session.redUserId = null; session.redPlayer = null; session.redName = 'Waiting...'; session.ready.red = false; session.redBox = [];
        }

        io.to(socket.id).emit('role_update', 'spectator');
        io.to(roomId).emit('update_state', getPublicState(session));
    });

    socket.on('player_ready', (roomId) => {
        const session = sessions[roomId];
        if (!session) return;
        session.lastActive = Date.now();
        
        if (socket.id === session.bluePlayer) session.ready.blue = true;
        if (socket.id === session.redPlayer) session.ready.red = true;
        io.to(roomId).emit('update_state', getPublicState(session));
        
        if (session.ready.blue && session.ready.red && !session.gameStarted) {
            session.gameStarted = true;
            if (session.draftType === 'gitcg_cup_2' || session.draftType === 'abyss_box') {
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

        if (session.draftType === 'abyss_box') {
            const isImmunePhase = session.immunityPhaseActive;
            const myBox = isBlue ? session.blueBox : session.redBox;
            
            if (isImmunePhase) {
                if (!session.blueBox.includes(charId) || !session.redBox.includes(charId)) return;
            } else {
                if (session.currentAction === 'ban') {
                    if (!session.blueBox.includes(charId) && !session.redBox.includes(charId)) return;
                } else {
                    if (!myBox.includes(charId)) return;
                }
            }
        }

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
});

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
    if (s.stepIndex >= s.draftOrder.length) {
        clearInterval(s.timerInterval);
        s.draftFinished = true;
        s.finishedAt = Date.now();
        saveMatchImmediately(s);
        return;
    }
    const c = s.draftOrder[s.stepIndex]; s.currentTeam = c.team; s.currentAction = c.type;
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
    
    // Если это chaos draft, выбираем из сгенерированного пула, иначе из всех персонажей
    if (session.draftType === 'chaos' && session.chaosPool) {
        Object.values(session.chaosPool).forEach(arr => available.push(...arr));
    } else {
        Object.values(CHARACTERS_BY_ELEMENT).forEach(arr => available.push(...arr));
    }
    
    session.lastActive = Date.now();

    if (session.immunityPhaseActive) {
        available = available.filter(c => {
            if (session.draftType === 'abyss_box' && (!session.blueBox.includes(c.id) || !session.redBox.includes(c.id))) return false;
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
        if (session.draftType === 'abyss_box') {
            if (session.currentAction === 'ban') {
                if (!session.blueBox.includes(c.id) && !session.redBox.includes(c.id)) return false;
            } else {
                const myBox = session.currentTeam === 'blue' ? session.blueBox : session.redBox;
                if (!myBox.includes(c.id)) return false;
            }
        }

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
            blueDiscordId: s.blueDiscordId, redDiscordId: s.redDiscordId,
            blueAvatar: s.blueAvatar, redAvatar: s.redAvatar, 
            bans: s.bans, bluePicks: s.bluePicks, redPicks: s.redPicks,
            immunityPool: s.immunityPool, immunityBans: s.immunityBans
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
        stepIndex: session.stepIndex + 1,
        currentTeam: session.currentTeam, currentAction: session.currentAction,
        bans: session.bans, bluePicks: session.bluePicks, redPicks: session.redPicks,
        blueName: session.blueName, redName: session.redName, draftType: session.draftType,
        blueDiscordId: session.blueDiscordId, redDiscordId: session.redDiscordId, 
        blueAvatar: session.blueAvatar, redAvatar: session.redAvatar,
        isBlueTaken: !!session.blueUserId, isRedTaken: !!session.redUserId,
        blueBox: session.blueBox || [], redBox: session.redBox || [], 
        immunityPhaseActive: session.immunityPhaseActive,
        immunityPool: session.immunityPool || [], immunityBans: session.immunityBans || [],
        chaosPool: session.chaosPool || null,
        draftFinished: session.draftFinished, ready: session.ready, gameStarted: session.gameStarted
    };
}

const CLEANUP_INTERVAL = 60 * 1000; 
const SESSION_TIMEOUT = 60 * 60 * 1000; 

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
