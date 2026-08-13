import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveJwtSecrets,
  DEV_JWT_SECRET,
  DEV_JWT_REFRESH_SECRET,
} from './jwtSecrets.js';

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
      () => resolveJwtSecrets({ NODE_ENV: 'production', JWT_REFRESH_SECRET: 'a-unique-refresh-secret-value' }),
      /JWT_SECRET must be set/
    );
  });

  it('fails fast in production when JWT_REFRESH_SECRET is missing', () => {
    assert.throws(
      () => resolveJwtSecrets({ NODE_ENV: 'production', JWT_SECRET: 'a-unique-access-secret-value' }),
      /JWT_REFRESH_SECRET must be set/
    );
  });

  it('rejects known default / dev-only secrets in production', () => {
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'avigilon-dashboard-secret-key-change-in-production',
        JWT_REFRESH_SECRET: 'a-unique-refresh-secret-value',
      }),
      /JWT_SECRET must be set/
    );
    assert.throws(
      () => resolveJwtSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'a-unique-access-secret-value',
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
        JWT_REFRESH_SECRET: 'a-unique-refresh-secret-value',
      }),
      /JWT_SECRET must be set/
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

  it('accepts unique production secrets', () => {
    const secrets = resolveJwtSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'prod-access-secret-value-32chars-min',
      JWT_REFRESH_SECRET: 'prod-refresh-secret-value-32chars',
    });
    assert.equal(secrets.jwtSecret, 'prod-access-secret-value-32chars-min');
    assert.equal(secrets.jwtRefreshSecret, 'prod-refresh-secret-value-32chars');
  });
});
