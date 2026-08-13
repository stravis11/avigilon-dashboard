# Priority 0 security notes

## JWT secrets (required in production)

When `NODE_ENV=production`, the backend **refuses to start** unless both secrets are set to unique, non-default values:

- `JWT_SECRET`
- `JWT_REFRESH_SECRET` (must differ from `JWT_SECRET`)

Generate with:

```bash
openssl rand -hex 32
```

Put them in `backend/.env` (never commit that file). Development may omit them and will use clearly-dev-only fallbacks so local docker-compose still works.

Optional: `COOKIE_SECURE=true|false` forces the cookie Secure flag. Default is auto from HTTPS / `X-Forwarded-Proto` (nginx already forwards this).

### Production fail-fast test

```bash
cd backend
NODE_ENV=production node src/index.js
# expect FATAL: JWT_SECRET must be set ... and a non-zero exit

NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) JWT_REFRESH_SECRET=$(openssl rand -hex 32) node src/index.js
# process should start (ACC/Zabbix env can still be missing)

cd backend && npm test   # jwtSecrets + cookie helper smoke tests
```

## Cookie auth

Login / refresh / logout go through Express. Access (~15m) and refresh (7d) JWTs are set as `HttpOnly; SameSite=Lax` cookies (`access_token`, `refresh_token`). They are **not** returned in JSON and **not** stored in `localStorage`.

- Docker: frontend nginx proxies `/api` to the backend (same origin). Cookie + `Set-Cookie` forwarding is enabled.
- Local Vite: `/api` proxies to `localhost:3001` with `cookieDomainRewrite`.
- Axios uses `withCredentials: true`. Live stream `fetch()` uses `credentials: 'include'`.
- Bearer `Authorization` is still accepted for non-browser API clients.
- Logout is public so expired access cookies can still be cleared.

After deploy, log in once so any leftover `localStorage` tokens from older builds are wiped.

## Logging

- `logger.info` / `logger.debug` are development-only.
- Object logs redact keys matching password/secret/token/authorization/cookie/nonce/api key/credential.
- ACC login no longer dumps response bodies (those can echo credentials).
- Unhandled 500 responses hide internal messages in production.

## Left unchanged (known constraints)

- ACC and Zabbix HTTPS clients still use `rejectUnauthorized: false` because typical appliances use private/self-signed certs. Do not tighten this without an env-gated alternative that matches real installs.
- Default first-run admin is still created if `users.json` is missing; the password is not logged.
- JSON user store is unchanged (out of scope).
