# Priority 0 security notes

## JWT secrets (required in production)

When `NODE_ENV=production`, the backend **refuses to start** unless both secrets are set to unique, non-default values of **at least 32 characters** (after trim):

- `JWT_SECRET`
- `JWT_REFRESH_SECRET` (must differ from `JWT_SECRET`)

`JWT_SECRET=a` / `JWT_REFRESH_SECRET=b` (or any value shorter than 32 characters) is rejected in production.

Generate with:

```bash
openssl rand -hex 32
```

That command produces 64 hex characters (32 bytes). Put them in `backend/.env` (never commit that file). Development may omit them and will use clearly-dev-only fallbacks so local docker-compose still works.

Optional: `COOKIE_SECURE=true|false` forces the cookie Secure flag. Default is auto from HTTPS / `X-Forwarded-Proto` (nginx already forwards this).

### Production fail-fast test

```bash
cd backend
NODE_ENV=production node src/index.js
# expect FATAL: JWT_SECRET must be set ... and a non-zero exit

NODE_ENV=production JWT_SECRET=a JWT_REFRESH_SECRET=b node src/index.js
# expect FATAL: secrets must be at least 32 characters

NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) JWT_REFRESH_SECRET=$(openssl rand -hex 32) node src/index.js
# process should start (ACC/Zabbix env can still be missing)

cd backend
npm test
```

## Cookie auth

Login / refresh / logout go through Express. Access (~15m) and refresh (7d) JWTs are set as `HttpOnly; SameSite=Lax` cookies (`access_token`, `refresh_token`). They are **not** returned in JSON and **not** stored in `localStorage`.

- Docker: frontend nginx proxies `/api` to the backend (same origin). Cookie + Set-Cookie forwarding is enabled.
- Local Vite: `/api` proxies to localhost:3001 with cookieDomainRewrite.
- Axios uses withCredentials true. Live stream fetch uses credentials include.
- Bearer Authorization is still accepted for non-browser API clients.
- Logout is public so expired access cookies can still be cleared.

After deploy, log in once so any leftover localStorage tokens from older builds are wiped.

## CSRF (cookie-authenticated mutating requests)

SameSite=Lax does **not** stop same-site / different-port attacks (an HTML form on another port of the same host can POST with cookies). CORS does not stop simple form POSTs.

The backend therefore:

1. Does **not** parse form-urlencoded bodies. The SPA and token-fetcher send JSON only.
2. Rejects form-urlencoded and multipart on POST/PUT/PATCH/DELETE. Requests with a body must use Content-Type application/json. Empty-body POSTs (logout) are allowed without a JSON content-type.
3. For unsafe methods, if an access_token or refresh_token cookie is present, requires Origin (preferred) or Referer to match ALLOWED_ORIGINS **or** the request own scheme+Host. A different port is **not** treated as same-site unless it is listed in ALLOWED_ORIGINS. Missing Origin and missing/invalid Referer means 403.
4. Bearer-only API clients (no auth cookies) skip the origin check.

There is no double-submit token; origin check plus JSON-only is the defense.

## Backend listen port and trust proxy

In Docker, **do not publish** the backend listen port on the host. nginx on 80/443 is the only public entry point (`/api` to backend:3001 on the Docker network). The token-fetcher also talks to http://backend:3001 internally.

Express sets trust proxy to 1 so Secure cookies and the rate limiter see the client IP from forwarded headers that nginx sets. That is only safe if the backend is not reachable except through nginx.

## Logging

- logger.info / logger.debug are development-only.
- Object logs redact keys matching password/secret/token/authorization/cookie/nonce/api key/credential.
- Startup no longer prints .env parse errors with extra context; ACC key presence is logged as a boolean in development only.
- Unhandled 500 responses hide internal messages in production.
- avigilonService still uses console.error for some ACC failures, including login response bodies. Treat that as a follow-up (do not log error.response.data in production).

## Left unchanged (known constraints)

- ACC and Zabbix HTTPS clients still use rejectUnauthorized: false because typical appliances use private/self-signed certs. Do not tighten this without an env-gated alternative that matches real installs.
- Default first-run admin is still created if users.json is missing; the password is not logged.
- JSON user store is unchanged (out of scope).
