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

// --- НАСТРОЙКА СЕССИЙ ---
const sessionMiddleware = session({
    secret: 'gitcg-super-secret-key', // Можешь написать любой текст
    resave: false,
    saveUninitialized: true
});
app.use(sessionMiddleware);

// --- НАСТРОЙКА DISCORD PASSPORT ---
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: 'ТВОЙ_CLIENT_ID_ИЗ_ДИСКОРДА',       // <--- ВСТАВЬ СВОЙ ID
    clientSecret: 'ТВОЙ_CLIENT_SECRET_ИЗ_ДИСКОРДА', // <--- ВСТАВЬ СВОЙ SECRET
    callbackURL: 'http://localhost:3000/auth/discord/callback',
    scope: ['identify']
}, function(accessToken, refreshToken, profile, done) {
    return done(null, profile);
}));

// Настройка EJS и статики
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Данные
const CHARACTERS_BY_ELEMENT = require('./characters.json');
const { DRAFT_RULES, IMMUNITY_ORDER } = require('./public/draft-rules.js');

// Подключение роутов
const indexRouter = require('./routes/index');
app.use('/', indexRouter);

// === ЛОГИКА SOCKET.IO ===
const sessions = {};

io.on('connection', (socket) => {
    // ВАЖНО: При реконнекте (rejoin_game) отправляем состояние всей комнате, чтобы обновить UI
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
        
        // Добавлено: Обновляем интерфейс у всех при возвращении игрока
        io.to(roomId).emit('update_state', getPublicState(session));
    });

    // ... ТУТ ОСТАЛЬНОЙ ТВОЙ КОД СОКЕТОВ ИЗ ПРОШЛОГО server.js (create_game, join_game, action и т.д.) ...
});

// ... Твои функции nextImmunityStep, autoPick и тд ...

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Platform started on http://localhost:${PORT}`));
