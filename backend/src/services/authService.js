import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class AuthService {
  constructor() {
    this.usersFilePath = join(__dirname, '..', 'data', 'users.json');
    this.jwtSecret = process.env.JWT_SECRET || 'avigilon-dashboard-secret-key-change-in-production';
    this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || 'avigilon-refresh-secret-key-change-in-production';
    this.users = [];
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    await this.loadUsers();
    this.initialized = true;
    console.log(`Auth service initialized with ${this.users.length} user(s)`);
  }

  async loadUsers() {
    try {
      const data = await fs.readFile(this.usersFilePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.users = parsed.users || [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create with default admin
        console.log('Users file not found, creating with default admin...');
        const defaultAdmin = {
          id: '1',
          username: 'admin',
          name: 'Administrator',
          email: 'admin@avigilon.local',
          password: await this.hashPassword('Avigilon'),
          role: 'admin',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.users = [defaultAdmin];
        await this.saveUsers();
      } else {
        console.error('Error loading users:', error);
        throw error;
      }
    }
  }

  async saveUsers() {
    try {
      const data = JSON.stringify({ users: this.users }, null, 2);
      await fs.writeFile(this.usersFilePath, data, 'utf-8');
    } catch (error) {
      console.error('Error saving users:', error);
      throw error;
    }
  }

  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  generateAccessToken(user) {
    return jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      this.jwtSecret,
      { expiresIn: '15m' }
    );
  }

  generateRefreshToken(user) {
    return jwt.sign(
      { id: user.id },
      this.jwtRefreshSecret,
      { expiresIn: '7d' }
    );
  }

  verifyAccessToken(token) {
    return jwt.verify(token, this.jwtSecret);
  }

  verifyRefreshToken(token) {
    return jwt.verify(token, this.jwtRefreshSecret);
  }

  // User CRUD operations

  async createUser(userData) {
    const { username, name, email, password, role = 'user' } = userData;

    // Check if username already exists
    const existingUser = this.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existingUser) {
      throw new Error('Username already exists');
    }

    // Check if email already exists
    const existingEmail = this.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingEmail) {
      throw new Error('Email already exists');
    }

    // Generate new ID
    const maxId = this.users.reduce((max, u) => Math.max(max, parseInt(u.id) || 0), 0);
    const newId = (maxId + 1).toString();

    const newUser = {
      id: newId,
      username,
      name,
      email,
      password: await this.hashPassword(password),
      role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.users.push(newUser);
    await this.saveUsers();

    return newUser;
  }

  async getUserById(id) {
    return this.users.find(u => u.id === id) || null;
  }

  async getUserByUsername(username) {
    return this.users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
  }

  async updateUser(id, updates) {
    const userIndex = this.users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      throw new Error('User not found');
    }

    const user = this.users[userIndex];

    // Check if updating username to one that already exists
    if (updates.username && updates.username.toLowerCase() !== user.username.toLowerCase()) {
      const existingUser = this.users.find(u => u.username.toLowerCase() === updates.username.toLowerCase());
      if (existingUser) {
        throw new Error('Username already exists');
      }
    }

    // Check if updating email to one that already exists
    if (updates.email && updates.email.toLowerCase() !== user.email.toLowerCase()) {
      const existingEmail = this.users.find(u => u.email.toLowerCase() === updates.email.toLowerCase());
      if (existingEmail) {
        throw new Error('Email already exists');
      }
    }

    // Hash password if being updated
    if (updates.password) {
      updates.password = await this.hashPassword(updates.password);
    }

    const updatedUser = {
      ...user,
      ...updates,
      id: user.id, // Prevent ID from being changed
      updatedAt: new Date().toISOString()
    };

    this.users[userIndex] = updatedUser;
    await this.saveUsers();

    return updatedUser;
  }

  async deleteUser(id) {
    const userIndex = this.users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      throw new Error('User not found');
    }

    const user = this.users[userIndex];

    // Prevent deleting the last admin
    if (user.role === 'admin') {
      const adminCount = this.users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        throw new Error('Cannot delete the last admin user');
      }
    }

    this.users.splice(userIndex, 1);
    await this.saveUsers();

    return true;
  }

  async getAllUsers() {
    return this.users;
  }
}

const authService = new AuthService();
export default authService;
