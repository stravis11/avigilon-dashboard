import authService from '../services/authService.js';

/**
 * GET /api/auth/users
 * Get all users (admin only)
 */
export const getUsers = async (req, res) => {
  try {
    const users = await authService.getAllUsers();
    // Remove password field from response
    const sanitizedUsers = users.map(({ password, ...user }) => user);
    res.json({
      success: true,
      data: sanitizedUsers
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * POST /api/auth/users
 * Create a new user (admin only)
 */
export const createUser = async (req, res) => {
  try {
    const { username, name, email, password, role } = req.body;

    // Validation
    if (!username || !name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username, name, email, and password are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Validate role
    if (role && !['admin', 'user'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be either "admin" or "user"'
      });
    }

    const user = await authService.createUser({
      username,
      name,
      email,
      password,
      role: role || 'user'
    });

    const { password: _, ...sanitizedUser } = user;
    res.status(201).json({
      success: true,
      data: sanitizedUser
    });
  } catch (error) {
    console.error('Create user error:', error);
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * PUT /api/auth/users/:id
 * Update a user (admin only)
 */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, name, email, password, role } = req.body;

    // Build updates object with only provided fields
    const updates = {};
    if (username !== undefined) updates.username = username;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (password !== undefined) updates.password = password;
    if (role !== undefined) updates.role = role;

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }
    }

    // Validate password length if provided
    if (password && password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Validate role if provided
    if (role && !['admin', 'user'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be either "admin" or "user"'
      });
    }

    const user = await authService.updateUser(id, updates);
    const { password: _, ...sanitizedUser } = user;

    res.json({
      success: true,
      data: sanitizedUser
    });
  } catch (error) {
    console.error('Update user error:', error);
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * DELETE /api/auth/users/:id
 * Delete a user (admin only)
 */
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    await authService.deleteUser(id);

    res.json({
      success: true,
      data: { message: 'User deleted successfully' }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    if (error.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    if (error.message.includes('last admin')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
