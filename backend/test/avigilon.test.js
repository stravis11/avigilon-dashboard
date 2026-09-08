import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import AvigilonService from '../src/services/avigilonService.js';

test('login 401 rejects promptly, allows retry, and deduplicates concurrent callers', { timeout: 3000 }, async t => {
  let rejectLogin = true, calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    res.writeHead(rejectLogin ? 401 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rejectLogin ? { error: 'rejected' } : { status: 'success', result: { session: 'mock-session' } }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const service = new AvigilonService();
  service.baseURL = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(service.login());
  assert.equal(service._pendingLogin, null);
  rejectLogin = false;
  await Promise.all([service.login(), service.login()]);
  assert.equal(calls, 2);
});

test('failed poll and manual refresh preserve last good inventory and report failure', async () => {
  const service = new AvigilonService();
  const previous = { result: { cameras: [{ id: 'known' }] } };
  service.cache.set('cameras_default', { data: previous, expiry: Date.now() - 1 });
  service.ensureSession = async () => { throw new Error('ACC unavailable'); };
  assert.deepEqual(await service.getCameras(), previous);
  await assert.rejects(service.refreshCache(), /ACC unavailable/);
  assert.deepEqual(service.getCached('cameras_default'), previous);
  assert.equal(service.getCacheAge().isStale, true);
});

test('successful poll replaces expired inventory and recomputes dashboard counts', async () => {
  const service = new AvigilonService();
  service.cache.set('dashboard_stats', { data: { totalViews: 999 }, expiry: Date.now() - 1 });
  service.ensureSession = async () => {};
  service.axiosInstance = { get: async url => ({ data: { result: url.endsWith('cameras') ? { cameras: [] } : { servers: [] } } }) };
  await service.refreshCache();
  assert.equal((await service.getDashboardStats()).totalViews, 0);
  assert.equal(service.getCacheAge().isStale, false);
});
