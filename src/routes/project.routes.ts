import { Router } from 'express';
import { verifyToken, createRoleGuard } from '../middleware/auth';
import { create, list, getOne, update, archive, getMembers, addMember, removeMember } from '../controllers/project.controller';
import { create as createTask, list as listTasks, board } from '../controllers/task.controller';

const router = Router();

// All project routes require authentication
router.use(verifyToken);

// ─── Project CRUD ─────────────────────────────────────────────────────────────
router.post('/', createRoleGuard('OWNER', 'ADMIN'), create);
router.get('/', list);
router.get('/:id', getOne);
router.patch('/:id', createRoleGuard('OWNER', 'ADMIN'), update);
router.delete('/:id', createRoleGuard('OWNER', 'ADMIN'), archive);

// ─── Project Members ──────────────────────────────────────────────────────────
router.get('/:id/members', getMembers);
router.post('/:id/members', createRoleGuard('OWNER', 'ADMIN'), addMember);
router.delete('/:id/members/:userId', createRoleGuard('OWNER', 'ADMIN'), removeMember);

// ─── Project Tasks (board MUST be before /:taskId) ───────────────────────────
router.get('/:id/tasks/board', board);        // GET /api/projects/:id/tasks/board
router.get('/:id/tasks', listTasks);          // GET /api/projects/:id/tasks
router.post('/:id/tasks', createTask);         // POST /api/projects/:id/tasks

export default router;
