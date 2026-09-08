import authService from '../services/authService.js';

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 */
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    const { user, accessToken, refreshToken } = await authService.login(username, password);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role
        },
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    let accessToken;
    try { accessToken = authService.refreshAccessToken(token); }
    catch { return res.status(401).json({ success: false, error: 'Session expired. Please sign in again.' }); }

    res.json({
      success: true,
      data: {
        accessToken
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * POST /api/auth/logout
 * Revoke the current session
 */
export const logout = async (req, res) => {
  try {
    await authService.logout(req.user.sid);
    res.json({
      success: true,
      data: { message: 'Logged out successfully' }
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message
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
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;

    const updatedUser = await authService.updateUser(req.user.id, updates);
    res.json({
      success: true,
      data: {
        id: updatedUser.id,
        username: updatedUser.username,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    const status = error.status || 500;
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
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }

    await authService.updateUser(req.user.id, { password: newPassword }, { currentPassword });
    res.json({ success: true, data: { message: 'Password changed successfully' } });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
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
      data: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
};
