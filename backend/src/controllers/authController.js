import authService from '../services/authService.js';
import { logger } from '../utils/logger.js';
import {
  setAuthCookies,
  clearAuthCookies,
  getRefreshTokenFromRequest,
} from '../utils/authCookies.js';

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  name: user.name,
  email: user.email,
  role: user.role,
});

/**
 * POST /api/auth/login
 * Authenticate user and set HttpOnly auth cookies
 */
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    const user = await authService.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const isValidPassword = await authService.verifyPassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const accessToken = authService.generateAccessToken(user);
    const refreshToken = authService.generateRefreshToken(user);
    setAuthCookies(res, req, { accessToken, refreshToken });

    res.json({
      success: true,
      data: {
        user: publicUser(user)
      }
    });
  } catch (error) {
    logger.error('Login error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
};

/**
 * POST /api/auth/refresh
 * Refresh access token using HttpOnly refresh cookie (body token accepted for API clients)
 */
export const refreshToken = async (req, res) => {
  try {
    const token = getRefreshTokenFromRequest(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    let decoded;
    try {
      decoded = authService.verifyRefreshToken(token);
    } catch (error) {
      clearAuthCookies(res, req);
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token'
      });
    }

    const user = await authService.getUserById(decoded.id);
    if (!user) {
      clearAuthCookies(res, req);
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    const accessToken = authService.generateAccessToken(user);
    setAuthCookies(res, req, { accessToken });

    res.json({
      success: true,
      data: {
        user: publicUser(user)
      }
    });
  } catch (error) {
    logger.error('Token refresh error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
};

/**
 * POST /api/auth/logout
 * Clear auth cookies. Public so expired sessions can still log out.
 */
export const logout = async (req, res) => {
  try {
    clearAuthCookies(res, req);
    res.json({
      success: true,
      data: { message: 'Logged out successfully' }
    });
  } catch (error) {
    logger.error('Logout error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
};

/**
 * PUT /api/auth/profile
 * Update current user's name and/or email
 */
export const updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name && !email) {
      return res.status(400).json({ success: false, error: 'At least one field (name or email) is required' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (email !== undefined) updates.email = email.trim().toLowerCase();

    const updatedUser = await authService.updateUser(req.user.id, updates);
    res.json({
      success: true,
      data: publicUser(updatedUser),
    });
  } catch (error) {
    const status = error.message === 'Email already exists' ? 409 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * PUT /api/auth/profile/password
 * Change current user's password (requires current password for verification)
 */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }

    const user = await authService.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const isValid = await authService.verifyPassword(currentPassword, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    await authService.updateUser(req.user.id, { password: newPassword });
    res.json({ success: true, data: { message: 'Password changed successfully' } });
  } catch (error) {
    logger.error('Change password error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
};

/**
 * GET /api/auth/me
 * Get current authenticated user info
 */
export const getCurrentUser = async (req, res) => {
  try {
    const user = await authService.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: publicUser(user)
    });
  } catch (error) {
    logger.error('Get current user error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to load user'
    });
  }
};
