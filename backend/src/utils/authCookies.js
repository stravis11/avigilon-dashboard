export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // matches JWT access lifetime (~15m)
export const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // matches JWT refresh lifetime (7d)

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

export function isSecureRequest(req, env = process.env) {
  if (env.COOKIE_SECURE === 'true') return true;
  if (env.COOKIE_SECURE === 'false') return false;
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return Boolean(req.secure) || proto === 'https';
}

export function cookieBaseOptions(req) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
  };
}

export function setAuthCookies(res, req, { accessToken, refreshToken } = {}) {
  const base = cookieBaseOptions(req);
  if (accessToken) {
    res.cookie(ACCESS_COOKIE, accessToken, { ...base, maxAge: ACCESS_MAX_AGE_MS });
  }
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, { ...base, maxAge: REFRESH_MAX_AGE_MS });
  }
}

export function clearAuthCookies(res, req) {
  const base = cookieBaseOptions(req);
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

export function getAccessTokenFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie);
  if (cookies[ACCESS_COOKIE]) return cookies[ACCESS_COOKIE];

  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && String(authHeader).startsWith('Bearer ')) {
    return String(authHeader).slice('Bearer '.length);
  }
  return null;
}

export function getRefreshTokenFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie);
  if (cookies[REFRESH_COOKIE]) return cookies[REFRESH_COOKIE];
  return req.body?.refreshToken || null;
}
