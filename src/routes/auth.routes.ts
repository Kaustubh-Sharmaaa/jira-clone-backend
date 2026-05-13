import { Router } from 'express';
import {
  login,
  register,
  logout,
  logoutAll,
  refresh,
  me,
  forgotPassword,
  resetPasswordHandler,
  changePassword,
} from '../controllers/auth.controller';
import { verifyToken } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// ─── Public routes ────────────────────────────────────────────────────────────
router.post('/register', authRateLimiter, register);
router.post('/login', authRateLimiter, login);
router.post('/refresh', authRateLimiter, refresh);
router.post('/logout', logout);
router.post('/forgot-password', authRateLimiter, forgotPassword);
router.post('/reset-password', authRateLimiter, resetPasswordHandler);

// ─── Protected routes (require valid access token) ────────────────────────────
router.get('/me', verifyToken, me);
router.post('/change-password', verifyToken, changePassword);
router.post('/logout-all', verifyToken, logoutAll);

export default router;
