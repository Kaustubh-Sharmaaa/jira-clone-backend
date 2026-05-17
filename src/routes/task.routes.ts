import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { getOne, update, updateStatus, remove } from '../controllers/task.controller';

const router = Router();

router.use(verifyToken);

router.get('/:id', getOne);
router.patch('/:id', update);
router.patch('/:id/status', updateStatus);
router.delete('/:id', remove);

export default router;
