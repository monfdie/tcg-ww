const { randomUUID } = require('node:crypto');

// Persist guest ownership before the page opens its WebSocket connection.
function ensureGuestIdentity(req, res, next) {
    if (!req.session.guestId) req.session.guestId = randomUUID();
    next();
}

function socketIdentity(User) {
    return async (socket, next) => {
        try {
            const session = socket.request.session;
            if (!session) return next(new Error('Session required. Reload the page.'));

            const accountId = session.passport?.user;
            if (accountId) {
                const user = await User.findById(accountId);
                if (!user) return next(new Error('Account not found. Sign in again.'));
                socket.data.identity = {
                    id: `user:${user.id}`,
                    nickname: user.username,
                    discordId: user.discordId,
                    avatar: user.avatar
                };
            } else {
                if (!session.guestId) return next(new Error('Session required. Reload the page.'));
                socket.data.identity = {
                    id: `guest:${session.guestId}`,
                    nickname: null,
                    discordId: null,
                    avatar: null
                };
            }
            next();
        } catch (error) {
            next(new Error('Unable to verify session. Try reconnecting.'));
        }
    };
}

module.exports = { ensureGuestIdentity, socketIdentity };
