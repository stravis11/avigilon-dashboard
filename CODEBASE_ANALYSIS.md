# Codebase Analysis: Avigilon Dashboard

## 1) Executive Summary

This repository is a **three-service, containerized full-stack system**:

- **Frontend**: React + Vite + Tailwind SPA served by nginx.
- **Backend**: Express API that proxies Avigilon ACC endpoints, manages local user auth, and aggregates cloud hardware-health data.
- **Token Fetcher**: Python + Playwright automation that retrieves cloud JWT tokens and submits them to the backend.

The project is functionally rich and has a clear service separation, but its current implementation is weighted toward rapid operational practicality rather than strict production hardening.

## 2) Architecture Snapshot

### Service boundaries

- `frontend/`: UI routes for dashboard, cameras, cloud settings, and admin users.
- `backend/`: API routing, authentication, ACC integration, cloud integration, token refresh trigger endpoint.
- `token-fetcher/`: out-of-band token capture and scheduled refresh.

### Runtime topology

- Docker Compose defines the three services and binds frontend on `3000`, backend on `3001`, with backend user data persisted via volume mapping (`backend/src/data`).
- Token fetcher depends on backend health and posts token data back to backend.

## 3) Strengths

1. **Clean service decomposition**
   - Frontend/backend/fetcher responsibilities are cleanly separated, making deployment and operational debugging straightforward.

2. **Pragmatic security baseline**
   - Backend uses `helmet`, CORS configuration, and API rate limiting.
   - Auth middleware is consistently applied on protected routes.

3. **User administration coverage**
   - Local auth includes login/refresh/logout and full admin CRUD with safeguards like "cannot delete last admin".

4. **Caching strategy for expensive data paths**
   - ACC and cloud services both cache data; cloud health summary has long-lived cache to preserve value after short JWT expiry.

5. **Good operational ergonomics**
   - Startup prewarming in backend and token refresh trigger endpoint reduce manual maintenance burden.

## 4) Key Risks / Gaps

### A. Security and secrets management

- **Hardcoded default JWT secrets** are used if env vars are absent. This is risky in any shared or public environment.
- **JWT access and refresh tokens are stored in `localStorage`** on the frontend, increasing XSS blast radius versus secure HttpOnly cookies.
- **ACC TLS certificate validation is disabled** (`rejectUnauthorized: false`), which may be necessary in some deployments but should be explicitly treated as a risk profile choice.

### B. Data model / persistence limitations

- User store is a JSON file in a mounted volume. This is simple and workable for small deployments but lacks transaction guarantees, auditability, and scale characteristics of a database-backed identity store.

### C. Excessive debug logging in production path

- Startup and service layers log environment-status details and error internals heavily; useful for setup but potentially noisy and security-sensitive in production logs.

### D. API contract drift risk

- README route docs and some code comments indicate endpoint paths that can diverge from actual route definitions over time. This is manageable now but likely to become a maintenance footgun without generated API docs or schema tests.

### E. Test coverage gap

- No backend or frontend automated test suite is currently wired into package scripts beyond a placeholder backend `test` script.

## 5) Priority Recommendations

### Priority 0 (immediate hardening)

1. **Fail fast when JWT secrets are missing** in production mode.
2. **Move auth tokens to secure HttpOnly cookie flow** (or document and enforce CSP/XSS mitigations if localStorage must remain).
3. **Gate verbose logging by environment** and remove sensitive context from logs.

### Priority 1 (reliability + maintainability)

4. **Add baseline tests**:
   - backend: route-level smoke tests for auth and health,
   - frontend: auth context + protected route behavior,
   - integration: one docker-compose smoke script.
5. **Introduce schema-based API documentation** (OpenAPI) and optionally generate client typings.

### Priority 2 (scalability)

6. **Replace file-based user persistence** with a proper datastore (e.g., SQLite/Postgres) and migration support.
7. **Externalize cache strategy** if deployment expands (e.g., Redis for multi-instance coherence).

## 6) Operational Readiness Assessment

- **Best fit today**: internal lab/ops tool or controlled network deployment.
- **Production readiness with minimal changes**: moderate effort, mostly in auth hardening, secrets policy, and testing.

## 7) Suggested Next 2-Week Plan

- **Week 1**
  - Secret validation + logging policy.
  - Add backend auth/health tests.
  - Align README endpoint matrix with actual routes.
- **Week 2**
  - Cookie-based auth refactor or XSS-hardening compensations.
  - Basic frontend route/auth tests.
  - Draft OpenAPI spec for currently implemented endpoints.

---

If useful, the next step can be a concrete implementation PR focused only on Priority 0 items (security hardening) to keep blast radius small.
