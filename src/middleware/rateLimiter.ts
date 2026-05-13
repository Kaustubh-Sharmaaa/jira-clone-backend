import rateLimit from 'express-rate-limit';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: { code: 429, message: 'Too many requests, please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: { code: 429, message: 'Too many requests, please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false,
});
