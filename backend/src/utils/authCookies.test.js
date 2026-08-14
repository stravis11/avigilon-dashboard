import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCookies,
  isSecureRequest,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from './authCookies.js';

describe('authCookies', () => {
  it('parses cookie headers', () => {
    const cookies = parseCookies('access_token=abc%20123; refresh_token=xyz');
    assert.equal(cookies[ACCESS_COOKIE], 'abc 123');
    assert.equal(cookies[REFRESH_COOKIE], 'xyz');
  });

  it('treats HTTPS via X-Forwarded-Proto as secure', () => {
    assert.equal(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } }, {}), true);
    assert.equal(isSecureRequest({ headers: { 'x-forwarded-proto': 'http' }, secure: false }, {}), false);
  });

  it('honors COOKIE_SECURE override', () => {
    assert.equal(isSecureRequest({ headers: {} }, { COOKIE_SECURE: 'true' }), true);
    assert.equal(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } }, { COOKIE_SECURE: 'false' }), false);
  });

  it('prefers cookie access token over Authorization header', () => {
    const token = getAccessTokenFromRequest({
      headers: {
        cookie: 'access_token=from-cookie',
        authorization: 'Bearer from-header',
      },
    });
    assert.equal(token, 'from-cookie');
  });

  it('falls back to Bearer token for API clients', () => {
    const token = getAccessTokenFromRequest({
      headers: { authorization: 'Bearer from-header' },
    });
    assert.equal(token, 'from-header');
  });

  it('reads refresh token from cookie, then body', () => {
    assert.equal(
      getRefreshTokenFromRequest({ headers: { cookie: 'refresh_token=from-cookie' }, body: {} }),
      'from-cookie'
    );
    assert.equal(
      getRefreshTokenFromRequest({ headers: {}, body: { refreshToken: 'from-body' } }),
      'from-body'
    );
  });
});
