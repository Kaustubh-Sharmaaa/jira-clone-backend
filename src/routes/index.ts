import { Router } from 'express';
import tenantRoutes from './tenant.routes';
import authRoutes from './auth.routes';

const router = Router();

router.use('/tenants', tenantRoutes);
router.use('/auth', authRoutes);

export default router;
