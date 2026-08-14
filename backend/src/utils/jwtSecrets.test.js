import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveJwtSecrets,
  DEV_JWT_SECRET,
  DEV_JWT_REFRESH_SECRET,
  MIN_JWT_SECRET_LENGTH,
} from './jwtSecrets.js';

const PROD_ACCESS = 'prod-access-secret-value-32chars-min';
const PROD_REFRESH = 'prod-refresh-secret-value-32chars';

describe('resolveJwtSecrets', () => {
  it('uses clearly-dev-only fallbacks when secrets are missing outside production', () => {
    const secrets = resolveJwtSecrets({ NODE_ENV: 'development' });
    assert.equal(secrets.jwtSecret, DEV_JWT_SECRET);
    assert.equal(secrets.jwtRefreshSecret, DEV_JWT_REFRESH_SECRET);
  });

  it('uses provided secrets in development', () => {
    const secrets = resolveJwtSecrets({
      NODE_ENV: 'development',
      JWT_SECRET: 'local-access',
      JWT_REFRESH_SECRET: 'local-refresh',
    });
    assert.equal(secrets.jwtSecret, 'local-access');
    assert.equal(secrets.jwtRefreshSecret, 'local-refresh');
  });

  it('fails fast in production when JWT_SECRET is missing', () => {
    assert.throws(
      () => resolveJwtSecrets({ NODE_ENV: 'production', JWT_REFRESH_SECRET: PROD_REFRESH }),
      /JWT_SECRET must be set/
    );
  });

  it('fails fast in production when JWT_REFRESH_SECRET is missing', () => {
    assert.throws(
      () => resolveJwtSecrets({ NODE_ENV: 'production', JWT_SECRET: PROD_ACCESS }),
      /JWT_REFRESH_SECRET must be set/
    );
  });

  it('rejects known default / dev-only secrets in production', () => {
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'avigilon-dashboard-secret-key-change-in-production',
        JWT_REFRESH_SECRET: PROD_REFRESH,
      }),
      /JWT_SECRET must be set/
    );
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: PROD_ACCESS,
        JWT_REFRESH_SECRET: DEV_JWT_REFRESH_SECRET,
      }),
      /JWT_REFRESH_SECRET must be set/
    );
  });

  it('rejects empty or whitespace secrets in production', () => {
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: '   ',
        JWT_REFRESH_SECRET: PROD_REFRESH,
      }),
      /JWT_SECRET must be set/
    );
  });

  it('rejects 1-character secrets in production (JWT_SECRET=a / JWT_REFRESH_SECRET=b)', () => {
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'a',
        JWT_REFRESH_SECRET: 'b',
      }),
      /JWT_SECRET must be set/
    );
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: PROD_ACCESS,
        JWT_REFRESH_SECRET: 'b',
      }),
      /JWT_REFRESH_SECRET must be set/
    );
  });

  it('rejects secrets shorter than 32 characters in production', () => {
    const short = 'x'.repeat(MIN_JWT_SECRET_LENGTH - 1);
    assert.equal(short.length, 31);
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: short,
        JWT_REFRESH_SECRET: PROD_REFRESH,
      }),
      /at least 32/
    );
  });

  it('rejects identical access and refresh secrets in production', () => {
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'same-secret-value-for-both-tokens',
        JWT_REFRESH_SECRET: 'same-secret-value-for-both-tokens',
      }),
      /must be different/
    );
  });

  it('accepts unique production secrets of 32+ characters', () => {
    const secrets = resolveJwtSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: PROD_ACCESS,
      JWT_REFRESH_SECRET: PROD_REFRESH,
    });
    assert.equal(secrets.jwtSecret, PROD_ACCESS);
    assert.equal(secrets.jwtRefreshSecret, PROD_REFRESH);
  });

  it('accepts a valid 32-character pair in production', () => {
    const access = 'a'.repeat(32);
    const refresh = 'b'.repeat(32);
    const secrets = resolveJwtSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: access,
      JWT_REFRESH_SECRET: refresh,
    });
    assert.equal(secrets.jwtSecret, access);
    assert.equal(secrets.jwtRefreshSecret, refresh);
  });
});
