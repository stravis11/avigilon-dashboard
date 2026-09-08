import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs/promises';

const dataPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'users.json');
const invalidSecret = value => typeof value !== 'string' || value.length < 32 || value.includes('change-in-production');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = token => createHash('sha256').update(token).digest('hex');

export class AuthService {
  constructor({ usersFilePath = dataPath, jwtSecret = process.env.JWT_SECRET, jwtRefreshSecret = process.env.JWT_REFRESH_SECRET } = {}) {
    this.usersFilePath = usersFilePath;
    this.jwtSecret = jwtSecret;
    this.jwtRefreshSecret = jwtRefreshSecret;
    this.state = { users: [], sessions: [] };
    this.queue = Promise.resolve();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    if (invalidSecret(this.jwtSecret) || invalidSecret(this.jwtRefreshSecret) || this.jwtSecret === this.jwtRefreshSecret) {
      throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be distinct random secrets of at least 32 characters');
    }
    try {
      const parsed = JSON.parse(await fs.readFile(this.usersFilePath, 'utf8'));
      if (!Array.isArray(parsed.users)) throw new Error('Invalid users store');
      if (new Set(parsed.users.map(u => u.id)).size !== parsed.users.length) throw new Error('Duplicate user IDs in users store; repair before starting');
      this.state = { users: parsed.users, sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      if (!password || password.length < 12) throw new Error('Set BOOTSTRAP_ADMIN_PASSWORD (at least 12 characters) to create the first admin');
      await this.createUser({ username: 'admin', name: 'Administrator', email: 'admin@avigilon.local', password, role: 'admin' });
    }
    this.initialized = true;
  }

  // Single-process transactions: serialize validation + mutation, persist by atomic rename,
  // and only publish the new in-memory state after persistence succeeds.
  mutate(fn) {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.state);
      next.sessions = next.sessions.filter(s => s.expiresAt > Date.now());
      const result = await fn(next);
      await fs.mkdir(dirname(this.usersFilePath), { recursive: true });
      const temporary = `${this.usersFilePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
        await fs.rename(temporary, this.usersFilePath);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      this.state = next;
      return structuredClone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  hashPassword(password) { return bcrypt.hash(password, 10); }
  verifyPassword(password, hash) { return bcrypt.compare(password, hash); }
  async getUserById(id) { return structuredClone(this.state.users.find(u => u.id === id) || null); }
  async getUserByUsername(username) {
    if (typeof username !== 'string') return null;
    return structuredClone(this.state.users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null);
  }
  async getAllUsers() { return structuredClone(this.state.users); }

  accessToken(user, sid) {
    return jwt.sign({ id: user.id, sid, type: 'access' }, this.jwtSecret, { algorithm: 'HS256', expiresIn: '15m' });
  }

  async login(username, password) {
    return this.mutate(async state => {
      const user = state.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
      if (!user || typeof password !== 'string' || !await this.verifyPassword(password, user.password)) throw fail('Invalid credentials', 401);
      const sid = randomUUID();
      const refreshToken = jwt.sign({ id: user.id, sid, type: 'refresh' }, this.jwtRefreshSecret, { algorithm: 'HS256', expiresIn: '7d' });
      state.sessions.push({ id: sid, userId: user.id, refreshHash: digest(refreshToken), expiresAt: Date.now() + 7 * 86400000 });
      return { user, accessToken: this.accessToken(user, sid), refreshToken };
    });
  }

  verifySession(token, type) {
    const decoded = jwt.verify(token, type === 'access' ? this.jwtSecret : this.jwtRefreshSecret, { algorithms: ['HS256'] });
    if (decoded.type !== type || !decoded.sid) throw fail('Session expired. Please sign in again.', 401);
    const session = this.state.sessions.find(s => s.id === decoded.sid && s.userId === decoded.id && s.expiresAt > Date.now());
    const user = this.state.users.find(u => u.id === decoded.id);
    if (!session || !user || (type === 'refresh' && session.refreshHash !== digest(token))) throw fail('Session expired. Please sign in again.', 401);
    return { ...user, sid: session.id };
  }
  verifyAccessToken(token) {
    const { id, username, role, sid } = this.verifySession(token, 'access');
    return { id, username, role, sid };
  }
  refreshAccessToken(token) {
    const user = this.verifySession(token, 'refresh');
    return this.accessToken(user, user.sid);
  }
  logout(sid) { return this.mutate(state => { state.sessions = state.sessions.filter(s => s.id !== sid); return true; }); }

  validateUser(candidate, users, id) {
    for (const field of ['username', 'name', 'email']) {
      if (typeof candidate[field] !== 'string' || !candidate[field].trim()) throw fail(`${field} is required`);
      candidate[field] = candidate[field].trim();
    }
    candidate.email = candidate.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)) throw fail('Invalid email format');
    if (!['admin', 'user'].includes(candidate.role)) throw fail('Invalid role');
    if (users.some(u => u.id !== id && u.username.toLowerCase() === candidate.username.toLowerCase())) throw fail('Username already exists', 409);
    if (users.some(u => u.id !== id && u.email.toLowerCase() === candidate.email)) throw fail('Email already exists', 409);
  }
  validatePassword(password) {
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) throw fail('Password must have at least 8 characters and no more than 72 bytes');
  }
  createUser(data) {
    return this.mutate(async state => {
      const candidate = { id: randomUUID(), username: data.username, name: data.name, email: data.email, role: data.role || 'user' };
      this.validateUser(candidate, state.users);
      this.validatePassword(data.password);
      candidate.password = await this.hashPassword(data.password);
      candidate.createdAt = candidate.updatedAt = new Date().toISOString();
      state.users.push(candidate);
      return candidate;
    });
  }
  updateUser(id, updates, { currentPassword } = {}) {
    return this.mutate(async state => {
      const user = state.users.find(u => u.id === id);
      if (!user) throw fail('User not found', 404);
      if (currentPassword !== undefined && !await this.verifyPassword(currentPassword, user.password)) throw fail('Current password is incorrect', 401);
      const candidate = { ...user };
      for (const field of ['username', 'name', 'email', 'role']) if (updates[field] !== undefined) candidate[field] = updates[field];
      this.validateUser(candidate, state.users, id);
      if (user.role === 'admin' && candidate.role !== 'admin' && state.users.filter(u => u.role === 'admin').length === 1) throw fail('Cannot demote the last admin user');
      if (updates.password !== undefined) {
        this.validatePassword(updates.password);
        candidate.password = await this.hashPassword(updates.password);
      }
      if (updates.password !== undefined || candidate.role !== user.role) state.sessions = state.sessions.filter(s => s.userId !== id);
      candidate.updatedAt = new Date().toISOString();
      state.users[state.users.findIndex(u => u.id === id)] = candidate;
      return candidate;
    });
  }
  deleteUser(id) {
    return this.mutate(state => {
      const user = state.users.find(u => u.id === id);
      if (!user) throw fail('User not found', 404);
      if (user.role === 'admin' && state.users.filter(u => u.role === 'admin').length === 1) throw fail('Cannot delete the last admin user');
      state.users = state.users.filter(u => u.id !== id);
      state.sessions = state.sessions.filter(s => s.userId !== id);
      return true;
    });
  }
}
export default new AuthService();
