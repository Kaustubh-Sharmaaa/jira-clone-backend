import { Router } from 'express';
import { register } from '../controllers/tenant.controller';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', authRateLimiter, register);

export default router;
