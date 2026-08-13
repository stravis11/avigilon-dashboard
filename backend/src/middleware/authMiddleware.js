import authService from '../services/authService.js';
import { getAccessTokenFromRequest } from '../utils/authCookies.js';

/**
 * Middleware to verify JWT access token from HttpOnly cookie or Bearer header.
 * Sets req.user with decoded token payload on success
 */
export const authenticateToken = async (req, res, next) => {
  const token = getAccessTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  try {
    const decoded = authService.verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(403).json({
      success: false,
      error: 'Invalid token'
    });
  }
};

/**
 * Middleware to check if authenticated user is an admin
 * Must be used after authenticateToken middleware
 */
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
};
