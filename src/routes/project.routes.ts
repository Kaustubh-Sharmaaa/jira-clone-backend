import { Router } from 'express';
import { verifyToken, createRoleGuard } from '../middleware/auth';
import { create, list, getOne, update, archive, getMembers, addMember, removeMember } from '../controllers/project.controller';

const router = Router();

// All project routes require authentication and tenant membership
router.use(verifyToken);

// ─── Project CRUD ─────────────────────────────────────────────────────────────
router.post('/', createRoleGuard('OWNER', 'ADMIN'), create);
router.get('/', list);                                              // all tenant members can view
router.get('/:id', getOne);                                        // all tenant members can view
router.patch('/:id', createRoleGuard('OWNER', 'ADMIN'), update);
router.delete('/:id', createRoleGuard('OWNER', 'ADMIN'), archive); // soft-archive

// ─── Project Members ──────────────────────────────────────────────────────────
router.get('/:id/members', getMembers);                                              // all tenant members
router.post('/:id/members', createRoleGuard('OWNER', 'ADMIN'), addMember);
router.delete('/:id/members/:userId', createRoleGuard('OWNER', 'ADMIN'), removeMember);

export default router;
