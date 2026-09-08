import { API_BASE_URL, createSessionClient, clearSession } from './sessionClient';
const authClient = createSessionClient(`${API_BASE_URL}/auth`);

const authService = {
  /**
   * Login with username and password
   */
  login: async (username, password) => {
    const response = await authClient.post('/login', { username, password });
    return response.data;
  },

  /**
   * Refresh access token using refresh token
   */
  refreshToken: async (refreshToken) => {
    const response = await authClient.post('/refresh', { refreshToken });
    return response.data;
  },

  /**
   * Logout user
   */
  logout: async (accessToken) => {
    try {
      await authClient.post('/logout', {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch (error) {
      // Ignore logout errors - we'll clear local state anyway
      console.warn('Logout request failed:', error.message);
    }
  },

  /**
   * Get current authenticated user info
   */
  getCurrentUser: async (accessToken) => {
    const response = await authClient.get('/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  },

  // Self-service profile endpoints

  /**
   * Update current user's name and/or email
   */
  updateProfile: async (accessToken, data) => {
    const response = await authClient.put('/profile', data, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  },

  /**
   * Change current user's password
   */
  changePassword: async (accessToken, data) => {
    const response = await authClient.put('/profile/password', data, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.data.success) clearSession();
    return response.data;
  },

  // Admin endpoints

  /**
   * Get all users (admin only)
   */
  getUsers: async (accessToken) => {
    const response = await authClient.get('/users', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  },

  /**
   * Create a new user (admin only)
   */
  createUser: async (accessToken, userData) => {
    const response = await authClient.post('/users', userData, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  },

  /**
   * Update a user (admin only)
   */
  updateUser: async (accessToken, userId, userData) => {
    const response = await authClient.put(`/users/${userId}`, userData, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  },

  /**
   * Delete a user (admin only)
   */
  deleteUser: async (accessToken, userId) => {
    const response = await authClient.delete(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  },
};

export default authService;
