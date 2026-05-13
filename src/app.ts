import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { generalRateLimiter } from './middleware/rateLimiter';
import apiRoutes from './routes';

const app = express();

// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
  }),
);

// Body parsing
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true }));

// General rate limiter
app.use(generalRateLimiter);

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`--> ${req.method} ${req.path}`);
  next();
});

// Health check — no auth, no tenant required
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', apiRoutes);

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: { code: 404, message: 'Route not found' } });
});

// Global error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: { code: 500, message: 'Internal server error' } });
});

export default app;
