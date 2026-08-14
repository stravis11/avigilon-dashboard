import { parseCookies, ACCESS_COOKIE, REFRESH_COOKIE } from '../utils/authCookies.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORM_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
]);

export function getAllowedOrigins(env = process.env) {
  const raw = env.ALLOWED_ORIGINS;
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((item) => parseOriginHeader(item.trim()))
      .filter(Boolean);
  }
  return ['http://localhost:3000'];
}

export function getRequestScheme(req) {
  const forwarded = String(req.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwarded === 'http' || forwarded === 'https') return forwarded;
  if (req.protocol === 'https' || req.secure) return 'https';
  return 'http';
}

/**
 * Scheme + host of this request. Host includes a non-default port.
 * Default ports (80/443) are stripped so they compare equal to Origin.
 * A different port is NOT treated as same-site.
 */
export function getRequestOwnOrigin(req) {
  const host = String(req.headers?.host || '').trim();
  if (!host) return null;
  return parseOriginHeader(`${getRequestScheme(req)}://${host}`);
}

export function parseOriginHeader(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function originFromReferer(referer) {
  return parseOriginHeader(referer);
}

export function isAllowedBrowserOrigin(candidateOrigin, req, allowedOrigins) {
  if (!candidateOrigin) return false;
  if (allowedOrigins.includes(candidateOrigin)) return true;
  const own = getRequestOwnOrigin(req);
  return Boolean(own && candidateOrigin === own);
}

export function hasAuthCookie(req) {
  const cookies = parseCookies(req.headers?.cookie);
  return Boolean(cookies[ACCESS_COOKIE] || cookies[REFRESH_COOKIE]);
}

export function getContentType(req) {
  const raw = req.headers?.['content-type'] || '';
  return String(raw).split(';')[0].trim().toLowerCase();
}

export function isFormContentType(contentType) {
  return FORM_CONTENT_TYPES.has(contentType);
}

export function isJsonContentType(contentType) {
  return contentType === 'application/json';
}

export function requestHasBody(req) {
  const len = req.headers?.['content-length'];
  if (len !== undefined && len !== '') {
    const n = Number(len);
    if (Number.isFinite(n)) return n > 0;
  }
  const te = String(req.headers?.['transfer-encoding'] || '').toLowerCase();
  if (te && te !== 'identity') return true;
  if (req.body == null) return false;
  if (Buffer.isBuffer(req.body)) return req.body.length > 0;
  if (typeof req.body === 'string') return req.body.length > 0;
  if (typeof req.body === 'object') return Object.keys(req.body).length > 0;
  return false;
}

function reject(res, status, error) {
  return res.status(status).json({ success: false, error });
}

/**
 * CSRF + content-type guard for cookie-authenticated mutating requests.
 * Bearer-only API clients (no auth cookies) skip Origin checks.
 */
export function csrfProtection(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return next();

  const contentType = getContentType(req);

  if (isFormContentType(contentType)) {
    return reject(res, 415, 'Form-encoded requests are not allowed');
  }

  if (requestHasBody(req) && !isJsonContentType(contentType)) {
    return reject(res, 415, 'Content-Type must be application/json');
  }

  if (!hasAuthCookie(req)) return next();

  const allowed = getAllowedOrigins();
  const originHeader = req.headers?.origin;
  const refererHeader = req.headers?.referer || req.headers?.referrer;

  if (originHeader) {
    const origin = parseOriginHeader(originHeader);
    if (!isAllowedBrowserOrigin(origin, req, allowed)) {
      return reject(res, 403, 'Invalid request origin');
    }
    return next();
  }

  const fromReferer = originFromReferer(refererHeader);
  if (fromReferer && isAllowedBrowserOrigin(fromReferer, req, allowed)) {
    return next();
  }

  return reject(res, 403, 'Missing or invalid origin');
}
