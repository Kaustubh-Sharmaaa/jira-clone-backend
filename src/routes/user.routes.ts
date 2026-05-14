import { Router } from 'express';
import { verifyToken, createRoleGuard } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';
import {
  invite,
  acceptInviteHandler,
  getUsers,
  updateRole,
  deactivate,
} from '../controllers/user.controller';

const router = Router();

// ─── Public ───────────────────────────────────────────────────────────────────
router.post('/accept-invite', authRateLimiter, acceptInviteHandler);

// ─── Protected — OWNER or ADMIN only ─────────────────────────────────────────
router.post('/invite', verifyToken, createRoleGuard('OWNER', 'ADMIN'), invite);
router.get('/', verifyToken, createRoleGuard('OWNER', 'ADMIN'), getUsers);
router.patch('/:id/role', verifyToken, createRoleGuard('OWNER', 'ADMIN'), updateRole);
router.delete('/:id', verifyToken, createRoleGuard('OWNER', 'ADMIN'), deactivate);

export default router;
