import { Router } from 'express';
import tenantRoutes from './tenant.routes';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';

const router = Router();

router.use('/tenants', tenantRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

export default router;
