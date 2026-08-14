import express from 'express';
import { login, refreshToken, logout, getCurrentUser, updateProfile, changePassword } from '../controllers/authController.js';
import { getUsers, createUser, updateUser, deleteUser } from '../controllers/userController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes (no auth required)
router.post('/login', login);
router.post('/refresh', refreshToken);
// Logout is public so expired access cookies can still be cleared
router.post('/logout', logout);

// Protected routes (auth required)
router.get('/me', authenticateToken, getCurrentUser);

// Self-service profile routes (any authenticated user)
router.put('/profile', authenticateToken, updateProfile);
router.put('/profile/password', authenticateToken, changePassword);

// Admin-only routes
router.get('/users', authenticateToken, requireAdmin, getUsers);
router.post('/users', authenticateToken, requireAdmin, createUser);
router.put('/users/:id', authenticateToken, requireAdmin, updateUser);
router.delete('/users/:id', authenticateToken, requireAdmin, deleteUser);

export default router;
