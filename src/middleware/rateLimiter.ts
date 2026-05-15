import rateLimit from 'express-rate-limit';

const isDev = process.env.NODE_ENV === 'development';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 0 : 20, // 0 = unlimited in dev
  skip: () => isDev,
  message: { success: false, error: { code: 429, message: 'Too many requests, please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 0 : 100,
  skip: () => isDev,
  message: { success: false, error: { code: 429, message: 'Too many requests, please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false,
});
