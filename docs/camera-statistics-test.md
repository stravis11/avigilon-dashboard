# Camera statistics filter test

Branch: `codex/camera-statistics-filters`, based on `origin/main`.

The camera table now follows manufacturer, Avigilon generation, and model selections for all four online/offline view/device cards. Clearing a selection restores the parent scope. Device cards still show one row per device, and standby/migrated cameras remain excluded.

## Validation

Run `npm ci`, `npm test`, and `npm run build` from `frontend`.
The component tests click through all four cards, filter and clear each level, verify connection states and multi-head device deduplication, and check manufacturer normalization and model fallbacks.

## Test deployment

The test frontend runs at https://gtpd-synopta.police.gatech.edu/camera-stats and shares the existing backend on gtpd-synopta. Log in with the usual dashboard account. The previous frontend container, `avigilon-frontend`, is retained stopped for rollback; its files and image are preserved. The test frontend takes port 443 because port 8443 is not reachable from the client network.

Use a separate checkout at `/home/st87/avigilon-stats-test`. Build `frontend/dist` from that checkout, or transfer a verified build from the same commit. Start it from the checkout with:

```sh
docker stop avigilon-frontend
TEST_CERTS_DIR='/home/st87/avigilon-app 2/certs' docker compose -p avigilon-stats-test -f docker-compose.stats-test.yml up -d
```

To remove this test frontend and restore the previous dashboard:

```sh
TEST_CERTS_DIR='/home/st87/avigilon-app 2/certs' docker compose -p avigilon-stats-test -f docker-compose.stats-test.yml down
docker start avigilon-frontend
```

For acceptance, select each of the four summary cards, then select a manufacturer, a generation (Avigilon), and a model. Check that the table title and rows follow each selection. Clear or toggle each selection to restore the broader list. Device cards should collapse multiple views with the same IP into one row. Main should only be updated after user acceptance.

## Access from this Mac

Direct connections from this Mac to the server's HTTPS port also time out. An SSH tunnel was opened for testing at https://localhost:9443/camera-stats. Reopen it if necessary with:

```sh
ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:9443:127.0.0.1:443 gtpd-synopta.police.gatech.edu
```

The tunnel serves the deployed frontend on gtpd-synopta, not a local development build. The server certificate is not trusted by the in-app browser; any certificate exception must be handled by the user in their browser. HTTP checks through the tunnel returned 200 for the app and healthy status for the backend, and the served index matched the verified build's SHA-256 hash.
