import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  csrfProtection,
  parseOriginHeader,
  getRequestOwnOrigin,
  isAllowedBrowserOrigin,
  hasAuthCookie,
  requestHasBody,
  getAllowedOrigins,
} from './csrf.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function run(req) {
  const res = mockRes();
  let nextCalled = false;
  csrfProtection(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

const cookieReq = (overrides = {}) => {
  const { headers, body, ...rest } = overrides;
  return {
    method: 'POST',
    headers: {
      cookie: 'access_token=valid-cookie',
      host: 'dashboard.example.edu',
      'x-forwarded-proto': 'https',
      origin: 'https://dashboard.example.edu',
      'content-type': 'application/json',
      'content-length': '2',
      ...headers,
    },
    body: body !== undefined ? body : { name: 'x' },
    ...rest,
  };
};

describe('csrf helpers', () => {
  it('parses Origin and strips default ports', () => {
    assert.equal(parseOriginHeader('https://dashboard.example.edu'), 'https://dashboard.example.edu');
    assert.equal(parseOriginHeader('https://dashboard.example.edu:443'), 'https://dashboard.example.edu');
    assert.equal(parseOriginHeader('https://dashboard.example.edu:8443'), 'https://dashboard.example.edu:8443');
    assert.equal(parseOriginHeader('null'), null);
    assert.equal(parseOriginHeader(''), null);
  });

  it('builds own origin from Host + forwarded proto without treating other ports as same-site', () => {
    assert.equal(
      getRequestOwnOrigin({
        headers: { host: 'dashboard.example.edu', 'x-forwarded-proto': 'https' },
      }),
      'https://dashboard.example.edu'
    );
    assert.equal(
      getRequestOwnOrigin({
        headers: { host: 'dashboard.example.edu:3001', 'x-forwarded-proto': 'https' },
      }),
      'https://dashboard.example.edu:3001'
    );
  });

  it('allows ALLOWED_ORIGINS or exact same host, not a different port', () => {
    const req = {
      headers: { host: 'dashboard.example.edu', 'x-forwarded-proto': 'https' },
    };
    const allowed = ['http://localhost:3000', 'https://dashboard.example.edu'];
    assert.equal(isAllowedBrowserOrigin('https://dashboard.example.edu', req, allowed), true);
    assert.equal(isAllowedBrowserOrigin('http://localhost:3000', req, allowed), true);
    assert.equal(isAllowedBrowserOrigin('https://dashboard.example.edu:3001', req, allowed), false);
    assert.equal(isAllowedBrowserOrigin('https://evil.example.edu', req, allowed), false);
  });

  it('detects auth cookies and JSON bodies', () => {
    assert.equal(hasAuthCookie({ headers: { cookie: 'access_token=abc' } }), true);
    assert.equal(hasAuthCookie({ headers: { cookie: 'refresh_token=abc' } }), true);
    assert.equal(hasAuthCookie({ headers: { cookie: 'other=1' } }), false);
    assert.equal(hasAuthCookie({ headers: { authorization: 'Bearer tok' } }), false);
    assert.equal(requestHasBody({ headers: { 'content-length': '0' }, body: {} }), false);
    assert.equal(requestHasBody({ headers: { 'content-length': '12' }, body: { a: 1 } }), true);
  });
});

describe('csrfProtection middleware', () => {
  const previousOrigins = process.env.ALLOWED_ORIGINS;

  before(() => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://dashboard.example.edu';
  });

  after(() => {
    if (previousOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previousOrigins;
  });

  it('allows safe methods without checks', () => {
    const { res, nextCalled } = run({
      method: 'GET',
      headers: { cookie: 'access_token=abc', origin: 'https://evil.example' },
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it('allows JSON POST without auth cookies (login / API clients)', () => {
    const { nextCalled } = run({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '10',
        origin: 'https://evil.example',
      },
      body: { username: 'a' },
    });
    assert.equal(nextCalled, true);
  });

  it('rejects urlencoded and multipart form posts on API mutating routes', () => {
    const form = run({
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '7',
        origin: 'https://dashboard.example.edu',
      },
      body: 'a=1&b=2',
    });
    assert.equal(form.nextCalled, false);
    assert.equal(form.res.statusCode, 415);

    const multi = run({
      method: 'POST',
      headers: {
        cookie: 'access_token=abc',
        'content-type': 'multipart/form-data; boundary=----x',
        'content-length': '20',
        origin: 'https://dashboard.example.edu',
      },
      body: '----x',
    });
    assert.equal(multi.nextCalled, false);
    assert.equal(multi.res.statusCode, 415);
  });

  it('requires application/json when a body is present', () => {
    const { res, nextCalled } = run({
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'content-length': '2',
      },
      body: '{}',
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 415);
  });

  it('allows empty-body POST (logout) without JSON content-type', () => {
    const { nextCalled, res } = run({
      method: 'POST',
      headers: {
        cookie: 'access_token=abc',
        host: 'dashboard.example.edu',
        'x-forwarded-proto': 'https',
        origin: 'https://dashboard.example.edu',
        'content-length': '0',
      },
      body: {},
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it('still origin-checks cookie-authenticated empty POSTs', () => {
    const { nextCalled, res } = run({
      method: 'POST',
      headers: {
        cookie: 'refresh_token=abc',
        host: 'dashboard.example.edu',
        'x-forwarded-proto': 'https',
        'content-length': '0',
      },
      body: {},
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('allows cookie-authenticated JSON POST from ALLOWED_ORIGINS', () => {
    const { nextCalled } = run(cookieReq({
      headers: {
        cookie: 'access_token=valid-cookie',
        host: 'backend:3001',
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'content-length': '2',
      },
    }));
    assert.equal(nextCalled, true);
  });

  it('allows cookie-authenticated JSON POST from same host as the request (nginx SPA)', () => {
    const { nextCalled } = run(cookieReq());
    assert.equal(nextCalled, true);
  });

  it('rejects cookie-authenticated POST from a different port on the same host', () => {
    const { nextCalled, res } = run(cookieReq({
      headers: {
        cookie: 'access_token=valid-cookie',
        host: 'dashboard.example.edu:3001',
        'x-forwarded-proto': 'https',
        origin: 'https://dashboard.example.edu:8443',
        'content-type': 'application/json',
        'content-length': '2',
      },
    }));
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('rejects missing Origin and missing/invalid Referer on cookie-authenticated unsafe requests', () => {
    const { nextCalled, res } = run(cookieReq({
      headers: {
        cookie: 'access_token=valid-cookie',
        host: 'dashboard.example.edu',
        'x-forwarded-proto': 'https',
        origin: undefined,
        'content-type': 'application/json',
        'content-length': '2',
      },
    }));
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /origin/i);
  });

  it('falls back to Referer when Origin is missing', () => {
    const { nextCalled } = run(cookieReq({
      headers: {
        cookie: 'access_token=valid-cookie',
        host: 'dashboard.example.edu',
        'x-forwarded-proto': 'https',
        origin: undefined,
        referer: 'https://dashboard.example.edu/users',
        'content-type': 'application/json',
        'content-length': '2',
      },
    }));
    assert.equal(nextCalled, true);
  });

  it('does not fall back to Referer when Origin is present but invalid', () => {
    const { nextCalled, res } = run(cookieReq({
      headers: {
        cookie: 'access_token=valid-cookie',
        host: 'dashboard.example.edu',
        'x-forwarded-proto': 'https',
        origin: 'https://evil.example',
        referer: 'https://dashboard.example.edu/users',
        'content-type': 'application/json',
        'content-length': '2',
      },
    }));
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('skips origin checks for Bearer-only requests with no auth cookies', () => {
    const { nextCalled } = run({
      method: 'POST',
      headers: {
        authorization: 'Bearer api-token',
        origin: 'https://evil.example',
        'content-type': 'application/json',
        'content-length': '2',
      },
      body: { name: 'x' },
    });
    assert.equal(nextCalled, true);
  });

  it('still origin-checks when auth cookies are present even if Authorization is also set', () => {
    const { nextCalled, res } = run(cookieReq({
      headers: {
        cookie: 'access_token=valid-cookie',
        authorization: 'Bearer api-token',
        host: 'dashboard.example.edu',
        origin: 'https://evil.example',
        'content-type': 'application/json',
        'content-length': '2',
      },
    }));
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('applies origin checks to PUT, PATCH, and DELETE', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const { nextCalled, res } = run(cookieReq({
        method,
        headers: {
          cookie: 'access_token=valid-cookie',
          host: 'dashboard.example.edu',
          origin: 'https://evil.example',
          'content-type': 'application/json',
          'content-length': method === 'DELETE' ? '0' : '2',
        },
        body: method === 'DELETE' ? {} : { name: 'x' },
      }));
      assert.equal(nextCalled, false, method);
      assert.equal(res.statusCode, 403, method);
    }
  });

  it('canonicalizes ALLOWED_ORIGINS entries', () => {
    const origins = getAllowedOrigins({
      ALLOWED_ORIGINS: 'https://dashboard.example.edu:443, http://localhost:3000/',
    });
    assert.deepEqual(origins, ['https://dashboard.example.edu', 'http://localhost:3000']);
  });
});
