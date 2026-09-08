# Security and reliability test release

Tested on `codex/security-reliability-fixes` and merged into `main` at `fc19e88` after user acceptance on September 8, 2026. The deployment instructions below describe the retained test environment.

## Changes

- Required distinct random signing secrets; no public fallback keys or checked-in bootstrap account.
- Persistent revocable sessions, UUIDs for new users, serialized atomic account writes, duplicate-account checks, and last-admin protection. Existing numeric IDs and passwords are preserved. Password and role changes revoke all sessions for that account; logout revokes only that session. Expired and pre-upgrade tokens are refused.
- Shared frontend token renewal for API, account, and video requests; late renewals cannot restore a logged-out session.
- ACC login errors reject instead of waiting on the same login promise. Concurrent logins and inventory polls are deduplicated.
- Last successful inventory survives failed refreshes, with a visible stale-data message. Manual refresh errors are reported accurately.
- Correct server-information URL, manufacturer percentage denominator (physical devices), and thumbnail/media URL cleanup.
- Separate login throttling; single-hop proxy trust only when explicitly configured, with the backend published only on loopback in the standard Compose setup.
- Patched production dependency locks, Node 22 images, React Router 7, and the current jsPDF/AutoTable API. The qs override patches Express 4's transitive dependency while preserving its route API.

## Data and migration

The users file now contains `users` and `sessions`. The backend is designed for one process writing this store; do not mount it into multiple replicas. Keep a backup outside the checkout. Account/session mutations are persisted through a temporary file and atomic rename before in-memory state changes are published.

Before updating any existing deployment, back up its `backend/src/data/users.json`; the historical tracked file is removed in this release. Restore the backup into the ignored runtime data directory before starting. Configure JWT_SECRET and JWT_REFRESH_SECRET as different randomly generated secrets of at least 32 characters (`openssl rand -hex 32`, separately for each). The service fails closed if these are absent or invalid. An absent account store requires a private BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters, capped at bcrypt's 72-byte limit.

For this test deployment, `/home/st87/avigilon-security-test` holds a separate copy of the existing backend data and environment. New signing secrets are generated on the server and kept in its ignored `.env`. Account edits made while testing affect that copy only. They are not automatically promoted back to the original account store.

## Deployment on gtpd-synopta

Build and test locally, transfer the exact branch and its `frontend/dist`, then build the backend image on the server:

```sh
TEST_CERTS_DIR='/home/st87/avigilon-app 2/certs' docker compose -p avigilon-security-test -f docker-compose.security-test.yml build security-backend
```

Before starting, stop `avigilon-backend` and `avigilon-stats-test`. The new backend takes the `backend` network alias so the existing token-fetcher can submit to it. It has its own data copy. Start:

```sh
TEST_CERTS_DIR='/home/st87/avigilon-app 2/certs' docker compose -p avigilon-security-test -f docker-compose.security-test.yml up -d
```

The preview remains http://127.0.0.1:9080/camera-stats through the existing SSH tunnel. Reopen the tunnel if needed:

```sh
ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:9080:127.0.0.1:9080 gtpd-synopta.police.gatech.edu
```

The previous backend and frontend containers are retained stopped. To roll back:

```sh
TEST_CERTS_DIR='/home/st87/avigilon-app 2/certs' docker compose -p avigilon-security-test -f docker-compose.security-test.yml down
docker start avigilon-backend avigilon-stats-test
```

Do not start the old and new backends concurrently on the shared `backend` alias. The existing token-fetcher is reused, not duplicated. Original source files, credentials, and account data are preserved.

## Validation

Run `npm ci && npm test` in backend and frontend, then `npm run build` in frontend. Production-only npm audits are checked separately in each directory. Tests cover old-token rejection, session revocation and persistence, deletion/replacement, concurrent creation and demotion, write failures, HTTP account routes, ACC login rejection/recovery, cache outages/recovery, frontend renewal concurrency and logout races, thumbnail disposal, multi-head filter percentages, and PDF generation.

For acceptance, sign in again with your usual account. Check camera lists, all four statistics cards, manufacturer/model drill-downs, PDF export, and live video. Leave the page open past 15 minutes, then use profile/user management and open a stream. Use disposable test accounts to check demotion, deletion, and password reset; a reset signs the affected account out. Existing users' passwords do not need to be changed for the migration.

The additional audit questions about cloud-control role policy and internal CA/certificate trust are not changed in this release.
