import express from 'express';
import { login, refreshToken, logout, getCurrentUser } from '../controllers/authController.js';
import { getUsers, createUser, updateUser, deleteUser } from '../controllers/userController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes (no auth required)
router.post('/login', login);
router.post('/refresh', refreshToken);

// Protected routes (auth required)
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getCurrentUser);

// Admin-only routes
router.get('/users', authenticateToken, requireAdmin, getUsers);
router.post('/users', authenticateToken, requireAdmin, createUser);
router.put('/users/:id', authenticateToken, requireAdmin, updateUser);
router.delete('/users/:id', authenticateToken, requireAdmin, deleteUser);

export default router;
