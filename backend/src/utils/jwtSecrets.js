/**
 * Resolve JWT signing secrets.
 * Production (NODE_ENV=production) refuses to start without unique,
 * non-default JWT_SECRET and JWT_REFRESH_SECRET values of at least 32 characters.
 * Development keeps explicit dev-only fallbacks for local docker-compose.
 */

export const DEV_JWT_SECRET = 'dev-only-jwt-secret-do-not-use-in-production';
export const DEV_JWT_REFRESH_SECRET = 'dev-only-jwt-refresh-secret-do-not-use-in-production';
export const MIN_JWT_SECRET_LENGTH = 32;

const LEGACY_UNSAFE_SECRETS = new Set([
  'avigilon-dashboard-secret-key-change-in-production',
  'avigilon-refresh-secret-key-change-in-production',
  DEV_JWT_SECRET,
  DEV_JWT_REFRESH_SECRET,
]);

export function isUnsafeSecret(value) {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length < MIN_JWT_SECRET_LENGTH) return true;
  return LEGACY_UNSAFE_SECRETS.has(trimmed);
}

export function resolveJwtSecrets(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const jwtSecret = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET.trim() : '';
  const jwtRefreshSecret = typeof env.JWT_REFRESH_SECRET === 'string' ? env.JWT_REFRESH_SECRET.trim() : '';

  if (isProduction) {
    if (isUnsafeSecret(jwtSecret)) {
      throw new Error(
        'FATAL: JWT_SECRET must be set to a unique non-default value of at least 32 characters when NODE_ENV=production. Generate one with: openssl rand -hex 32'
      );
    }
    if (isUnsafeSecret(jwtRefreshSecret)) {
      throw new Error(
        'FATAL: JWT_REFRESH_SECRET must be set to a unique non-default value of at least 32 characters when NODE_ENV=production. Generate one with: openssl rand -hex 32'
      );
    }
    if (jwtSecret === jwtRefreshSecret) {
      throw new Error('FATAL: JWT_SECRET and JWT_REFRESH_SECRET must be different values');
    }
    return { jwtSecret, jwtRefreshSecret };
  }

  return {
    jwtSecret: jwtSecret || DEV_JWT_SECRET,
    jwtRefreshSecret: jwtRefreshSecret || DEV_JWT_REFRESH_SECRET,
  };
}
