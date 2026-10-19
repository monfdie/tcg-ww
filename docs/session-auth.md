# Sessions and draft ownership

Set `SESSION_SECRET` to a long, random secret in the server environment. Use the
same value across restarts and instances so existing signed session cookies remain
valid. Never put the secret in client JavaScript or commit it to the repository.
If omitted, the server generates a fresh secret at startup; restarting then signs
out existing sessions. The previous hardcoded signing secret is no longer used.

HTTP pages establish a session in the existing MongoDB session store before the
browser opens Socket.IO. Socket.IO loads that same session, looks up a signed-in
Discord user in the database, or uses a server-generated guest identity. Client
payloads cannot choose account IDs, Discord IDs or avatars. Guest nicknames remain
editable. A guest identity belongs to the browser session; separate browser sessions
are needed for separate guest players.

The client sends only room IDs, desired seats and guest nicknames. Reloading or
reconnecting in the same session restores seat ownership. A deployment of this
change resets in-memory rooms as before; old client-generated seat IDs are not
accepted as credentials.

Run `npm test` for real local HTTP/WebSocket checks covering session signatures,
impersonation attempts, occupied seats, guest/account reconnects, all retained draft
modes, match persistence calls and history rendering. MongoDB and Discord account
records are replaced with test data; live Discord OAuth and production MongoDB are
not contacted by these tests.
