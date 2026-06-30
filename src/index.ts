import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { apiLimiter, strictLimiter } from './middleware/rateLimiter';

// Load env configuration
dotenv.config();

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 5000;

// trust proxy is critical for resolving client IPs correctly behind load balancers/proxies
app.set('trust proxy', 1);

// Enable CORS
app.use(cors({
  origin: '*', // For local dev, allow all clients
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Apply Rate Limiters
// Enforce strict rate limit on brute-force sensitive routes (login, checkout creation)
app.use('/api/auth/login', strictLimiter);
app.use('/api/public/checkout', strictLimiter);

// Enforce general rate limiter on all API endpoints
app.use('/api', apiLimiter);

// Express Parser Middlewares
app.use(express.json());
// URL Encoded parsing is absolutely essential for handling PayU post-back callbacks
app.use(express.urlencoded({ extended: true }));

// Ensure uploads folder exists locally
const uploadsPath = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log(`Created uploads folder at: ${uploadsPath}`);
}

// Serve uploads folder as static files
app.use('/uploads', express.static(uploadsPath));

// Import routers
import authRouter from './routes/auth';
import publicRouter from './routes/public';
import paymentsRouter from './routes/payments';
import adminRouter from './routes/admin';

// Register routes
app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRouter);

// Basic root route
app.get('/', (req, res) => {
  res.json({
    message: 'MET Registrar Services & Verification Portal Backend is running.',
    version: '2.0.0 (Detailed MVP)',
    status: 'Healthy',
  });
});

// Global 404 Route handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal server error occurred' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` MET Registrar Portal Backend Server     `);
  console.log(` Listening on: http://localhost:${PORT}  `);
  console.log(` Mode: Development / Local Sandbox      `);
  console.log(`=========================================`);
});
