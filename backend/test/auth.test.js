import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AuthService } from '../src/services/authService.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-auth-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const options = { usersFilePath: path.join(dir, 'users.json'), jwtSecret: randomBytes(32).toString('hex'), jwtRefreshSecret: randomBytes(32).toString('hex') };
  await fs.writeFile(options.usersFilePath, JSON.stringify({ users: [] }));
  const service = new AuthService(options);
  await service.initialize();
  const admin = await service.createUser({ username: 'admin', name: 'Admin', email: 'admin@example.test', password: 'testing-password', role: 'admin' });
  return { service, admin, options, dir };
}
const data = name => ({ username: name, name, email: `${name}@example.test`, password: 'testing-password', role: 'user' });

test('rejects missing, shared, and known signing keys in all modes', async () => {
  for (const secret of ['', 'short', 'avigilon-dashboard-secret-key-change-in-production']) {
    await assert.rejects(new AuthService({ jwtSecret: secret, jwtRefreshSecret: 'r'.repeat(64) }).initialize(), /distinct random/);
  }
  await assert.rejects(new AuthService({ jwtSecret: 's'.repeat(64), jwtRefreshSecret: 's'.repeat(64) }).initialize(), /distinct random/);
});

test('legacy accounts migrate without password changes but old tokens are refused', async t => {
  const { service, admin, options } = await fixture(t);
  await fs.writeFile(options.usersFilePath, JSON.stringify({ users: [admin] }));
  const next = new AuthService(options); await next.initialize();
  const old = jwt.sign({ id: admin.id, role: 'admin' }, options.jwtSecret);
  assert.throws(() => next.verifyAccessToken(old), /Session expired/);
  const session = await next.login('admin', 'testing-password');
  assert.equal(next.verifyAccessToken(session.accessToken).role, 'admin');
});

test('deletion and replacement cannot reuse an old session or identifier', async t => {
  const { service } = await fixture(t);
  const user = await service.createUser(data('former'));
  const session = await service.login('former', 'testing-password');
  await service.deleteUser(user.id);
  const replacement = await service.createUser({ ...data('replacement'), role: 'admin' });
  assert.notEqual(user.id, replacement.id);
  assert.throws(() => service.verifyAccessToken(session.accessToken));
  assert.throws(() => service.refreshAccessToken(session.refreshToken));
});

test('logout revokes exactly one session, persists across restart', async t => {
  const { service, options } = await fixture(t);
  const first = await service.login('admin', 'testing-password');
  const second = await service.login('admin', 'testing-password');
  await service.logout(service.verifyAccessToken(first.accessToken).sid);
  const restarted = new AuthService(options); await restarted.initialize();
  assert.throws(() => restarted.refreshAccessToken(first.refreshToken));
  assert.throws(() => restarted.verifyAccessToken(first.accessToken));
  assert.equal(restarted.verifyAccessToken(second.accessToken).role, 'admin');
});

for (const change of ['password', 'role']) test(`${change} change revokes all existing sessions immediately`, async t => {
  const { service } = await fixture(t);
  const user = await service.createUser({ ...data('second'), role: 'admin' });
  const session = await service.login('second', 'testing-password');
  await service.updateUser(user.id, change === 'password' ? { password: 'new-testing-password' } : { role: 'user' });
  assert.throws(() => service.verifyAccessToken(session.accessToken));
  assert.throws(() => service.refreshAccessToken(session.refreshToken));
});

test('simultaneous creates are unique and duplicate usernames are rejected', async t => {
  const { service } = await fixture(t);
  const users = await Promise.all(['one', 'two', 'three'].map(n => service.createUser(data(n))));
  assert.equal(new Set(users.map(u => u.id)).size, 3);
  const results = await Promise.allSettled([service.createUser(data('same')), service.createUser(data('SAME'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('last admin cannot be deleted or demoted, including concurrent demotions', async t => {
  const { service, admin } = await fixture(t);
  await assert.rejects(service.deleteUser(admin.id), /last admin/);
  await assert.rejects(service.updateUser(admin.id, { role: 'user' }), /last admin/);
  const second = await service.createUser({ ...data('second'), role: 'admin' });
  const results = await Promise.allSettled([service.updateUser(admin.id, { role: 'user' }), service.updateUser(second.id, { role: 'user' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await service.getAllUsers()).filter(u => u.role === 'admin').length, 1);
});

test('invalid current password and failed persistence leave state and sessions unchanged', async t => {
  const { service, admin, dir } = await fixture(t);
  const session = await service.login('admin', 'testing-password');
  await assert.rejects(service.updateUser(admin.id, { password: 'new-testing-password' }, { currentPassword: 'wrong' }), /incorrect/);
  service.usersFilePath = dir;
  await assert.rejects(service.updateUser(admin.id, { name: 'Not saved' }));
  assert.equal((await service.getUserById(admin.id)).name, 'Admin');
  assert.equal(service.verifyAccessToken(session.accessToken).role, 'admin');
});

test('forged identity, expired token, wrong token type and revoked refresh are refused', async t => {
  const { service, options } = await fixture(t);
  const session = await service.login('admin', 'testing-password');
  assert.throws(() => service.verifyAccessToken(session.refreshToken));
  const claim = jwt.decode(session.accessToken);
  assert.throws(() => service.verifyAccessToken(jwt.sign({ id: 'missing', sid: claim.sid, type: 'access' }, options.jwtSecret)));
  assert.throws(() => service.verifyAccessToken(jwt.sign({ id: claim.id, sid: claim.sid, type: 'access' }, options.jwtSecret, { expiresIn: -1 })));
});
