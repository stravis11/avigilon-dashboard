import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const authClient = axios.create({
  baseURL: `${API_BASE_URL}/auth`,
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const authService = {
  /**
   * Login with username and password.
   * Tokens are stored in HttpOnly cookies by the backend.
   */
  login: async (username, password) => {
    const response = await authClient.post('/login', { username, password });
    return response.data;
  },

  /**
   * Refresh access token using the HttpOnly refresh cookie
   */
  refreshToken: async () => {
    const response = await authClient.post('/refresh');
    return response.data;
  },

  /**
   * Logout user and clear auth cookies
   */
  logout: async () => {
    try {
      await authClient.post('/logout');
    } catch (error) {
      // Ignore logout errors - we'll clear local state anyway
      console.warn('Logout request failed:', error.message);
    }
  },

  /**
   * Get current authenticated user info
   */
  getCurrentUser: async () => {
    const response = await authClient.get('/me');
    return response.data;
  },

  // Self-service profile endpoints

  /**
   * Update current user's name and/or email
   */
  updateProfile: async (data) => {
    const response = await authClient.put('/profile', data);
    return response.data;
  },

  /**
   * Change current user's password
   */
  changePassword: async (data) => {
    const response = await authClient.put('/profile/password', data);
    return response.data;
  },

  // Admin endpoints

  /**
   * Get all users (admin only)
   */
  getUsers: async () => {
    const response = await authClient.get('/users');
    return response.data;
  },

  /**
   * Create a new user (admin only)
   */
  createUser: async (userData) => {
    const response = await authClient.post('/users', userData);
    return response.data;
  },

  /**
   * Update a user (admin only)
   */
  updateUser: async (userId, userData) => {
    const response = await authClient.put(`/users/${userId}`, userData);
    return response.data;
  },

  /**
   * Delete a user (admin only)
   */
  deleteUser: async (userId) => {
    const response = await authClient.delete(`/users/${userId}`);
    return response.data;
  },
};

export default authService;
