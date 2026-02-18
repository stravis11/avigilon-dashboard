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
const result = dotenv.config({ path: envPath });

// Import logger after dotenv so NODE_ENV is set
const { logger } = await import('./utils/logger.js');

logger.info('Loading .env from:', envPath);
if (result.error) {
  console.error('Error loading .env file:', result.error);
} else {
  logger.info('.env file loaded successfully');
  logger.info('ACC_USER_KEY present:', !!process.env.ACC_USER_KEY);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware - configure to allow cross-origin images and video streaming
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Allow camera snapshots (data URIs) and DASH blob segments
      imgSrc: ["'self'", 'data:', 'blob:'],
      // Required for DASH streaming via dash.js
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'blob:'],
      scriptSrc: ["'self'"],
      // unsafe-inline required for Tailwind CSS utility classes
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Hardening: block plugin/Flash content, clickjacking, base-tag injection, external form submissions
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
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

// Request logging middleware (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

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

// Cloud token submission - public endpoint protected by shared secret (for bookmarklet)
// Needs separate CORS to allow requests from the Avigilon cloud portal
const { submitCloudToken } = await import('./controllers/cloudController.js');
app.post('/api/cloud/token-submit',
  cors({ origin: ['https://us.cloud.avigilon.com', ...(process.env.ALLOWED_ORIGINS?.split(',') || [])], credentials: true }),
  (req, res) => {
    const { secret } = req.body;
    if (!secret || secret !== process.env.CLOUD_TOKEN_SECRET) {
      return res.status(403).json({ success: false, error: 'Invalid secret' });
    }
    submitCloudToken(req, res);
  }
);

// All other API routes require authentication
app.use('/api', authenticateToken, apiRoutes);

// Import service for cache pre-warming
const { default: avigilonService } = await import('./services/avigilonServiceInstance.js');

// Pre-warm cache on startup
const prewarmCache = async () => {
  logger.info('Pre-warming cache...');
  try {
    // Login first to avoid multiple simultaneous login attempts
    await avigilonService.login();

    // Then fetch all data in parallel to populate cache
    // Note: getServers() returns 404, so we use getServerIds() instead
    // getDashboardStats is included so the first user request is always a cache hit
    const [serversResult, sitesResult, camerasResult, statsResult] = await Promise.allSettled([
      avigilonService.getServerIds(),
      avigilonService.getSites(),
      avigilonService.getCameras(),
      avigilonService.getDashboardStats()
    ]);

    const results = {
      serverIds: serversResult.status === 'fulfilled' ? 'OK' : 'FAILED',
      sites: sitesResult.status === 'fulfilled' ? 'OK' : 'FAILED',
      cameras: camerasResult.status === 'fulfilled' ? 'OK' : 'FAILED',
      dashboardStats: statsResult.status === 'fulfilled' ? 'OK' : 'FAILED'
    };

    logger.info('Cache pre-warm complete:', results);

    logger.debug('=== Testing Health-Related Endpoints ===');
    try {
      await avigilonService.getEntities();
      logger.debug('Entities endpoint works!');
    } catch (err) {
      logger.debug('Entities endpoint error:', err.message);
    }

    try {
      await avigilonService.getEventSubtopics();
      logger.debug('Event-subtopics endpoint works!');
    } catch (err) {
      logger.debug('Event-subtopics endpoint error:', err.message);
    }
  } catch (error) {
    logger.error('Cache pre-warm failed:', error.message);
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
