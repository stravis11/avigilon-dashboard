import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const authClient = axios.create({
  baseURL: `${API_BASE_URL}/auth`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
