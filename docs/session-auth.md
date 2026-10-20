# Sessions and draft ownership

Set `SESSION_SECRET` to a long, random secret in the server environment. Use the
same value across restarts and instances so existing signed session cookies remain
valid. Never put the secret in client JavaScript or commit it to the repository.
The server refuses to start without it rather than generating a new key on each
restart. Local development loads it from the ignored `.env` file. On Render, set
`SESSION_SECRET` in the service's Environment settings before deploying this change.
Generate a value locally with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`,
then copy it into the hosting environment. Keep the same value for later deployments.
Changing the secret invalidates existing login cookies.

Login cookies persist for 30 days and renew on HTTP requests (`rolling: true`).
MongoDB session expiration uses the same 30-day lifetime. A browser restart or an
application restart does not invalidate an unexpired cookie when the secret and
MongoDB database stay the same. Explicit logout still signs the user out.
Existing cookies get the persistent expiration on their next request; users whose
old cookie is already gone need to sign in once again.

In production (`NODE_ENV=production`), cookies require HTTPS and the application
trusts one reverse proxy, matching the Render deployment. Local HTTP development
uses non-Secure cookies. Browser privacy settings, clearing site data, or private
browsing can still remove the cookie before its expiration.

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
