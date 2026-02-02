import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// IMPORTANT: Load environment variables FIRST
const envPath = join(__dirname, '..', '.env');
console.log('Loading .env from:', envPath);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error('Error loading .env file:', result.error);
} else {
  console.log('.env file loaded successfully');
  console.log('ACC_USER_KEY present:', !!process.env.ACC_USER_KEY);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware - configure to allow cross-origin images
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'http://localhost:3000', 'http://localhost:3001'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Rate limiting - high limit for camera snapshot requests
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Limit each IP to 10000 requests per windowMs (needed for many camera snapshots)
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Avigilon ACC API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      testConnection: '/api/test-connection',
      sites: '/api/sites',
      cameras: '/api/cameras',
      serverInfo: '/api/server/info',
    },
  });
});

// Dynamically import routes AFTER environment variables are loaded
// This ensures the service instance is created with proper env vars

// Import and initialize auth service
const { default: authService } = await import('./services/authService.js');
await authService.initialize();

// Import auth routes and middleware
const { default: authRoutes } = await import('./routes/auth.js');
const { authenticateToken } = await import('./middleware/authMiddleware.js');

// Mount auth routes (public endpoints for login/refresh)
app.use('/api/auth', authRoutes);

// Import API routes
const { default: apiRoutes } = await import('./routes/api.js');

// Health endpoint remains public (no auth required)
app.get('/api/health', (req, res, next) => {
  // Pass through to apiRoutes handler
  req.url = '/health';
  apiRoutes(req, res, next);
});

// All other API routes require authentication
app.use('/api', authenticateToken, apiRoutes);

// Import service for cache pre-warming
const { default: avigilonService } = await import('./services/avigilonServiceInstance.js');

// Pre-warm cache on startup
const prewarmCache = async () => {
  console.log('Pre-warming cache...');
  try {
    // Login first to avoid multiple simultaneous login attempts
    await avigilonService.login();

    // Then fetch all data in parallel to populate cache
    // Note: getServers() returns 404, so we use getServerIds() instead
    const [serversResult, sitesResult, camerasResult] = await Promise.allSettled([
      avigilonService.getServerIds(),
      avigilonService.getSites(),
      avigilonService.getCameras()
    ]);

    const results = {
      serverIds: serversResult.status === 'fulfilled' ? 'OK' : 'FAILED',
      sites: sitesResult.status === 'fulfilled' ? 'OK' : 'FAILED',
      cameras: camerasResult.status === 'fulfilled' ? 'OK' : 'FAILED'
    };

    console.log('Cache pre-warm complete:', results);
  } catch (error) {
    console.error('Cache pre-warm failed:', error.message);
  }
};

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║   Avigilon ACC API Server                      ║
║   Running on: http://localhost:${PORT}           ║
║   Environment: ${process.env.NODE_ENV || 'development'}                   ║
╚════════════════════════════════════════════════╝
  `);

  // Pre-warm cache after server starts
  prewarmCache();
});

export default app;
