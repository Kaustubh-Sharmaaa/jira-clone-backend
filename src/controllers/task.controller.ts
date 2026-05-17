import { Request, Response } from 'express';
import { z } from 'zod';
import { success, created, error } from '../utils/response';
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  changeTaskStatus,
  deleteTask,
  getBoardView,
} from '../services/task.service';
import { TaskStatus, Priority } from '@prisma/client';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const statusEnum = z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED']);
const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

const createSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  status: statusEnum.default('TODO'),
  priority: priorityEnum.default('MEDIUM'),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
  estimatedHours: z.number().positive().optional(),
  labels: z.array(z.string()).default([]),
  parentTaskId: z.string().uuid().optional(),
  sprintId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedHours: z.number().positive().nullable().optional(),
  labels: z.array(z.string()).optional(),
  taskOrder: z.number().int().min(0).optional(),
});

const statusSchema = z.object({
  status: statusEnum,
});

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.string().uuid().optional(),
  label: z.string().optional(),
});

// ─── Error handler helper ─────────────────────────────────────────────────────
function handleServiceError(err: unknown, res: Response) {
  if (err instanceof Error) {
    if (err.message === 'TASK_NOT_FOUND') return void error(res, 'Task not found', 404);
    if (err.message === 'PROJECT_NOT_FOUND') return void error(res, 'Project not found or archived', 404);
    if (err.message === 'STATUS_UNCHANGED') return void error(res, 'Task is already in that status', 400);
  }
  console.error('[task]', err);
  error(res, 'Internal server error', 500);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** POST /api/projects/:id/tasks */
export async function create(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map(e => e.message).join(', '), 400);
    return;
  }

  try {
    const task = await createTask({
      ...parsed.data,
      projectId: String(req.params.id),
      tenantId: req.tenantId,
      reporterId: req.userId,
    });
    created(res, { task });
  } catch (err) {
    handleServiceError(err, res);
  }
}

/** GET /api/projects/:id/tasks */
export async function list(req: Request, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    error(res, parsed.error.issues.map(e => e.message).join(', '), 400);
    return;
  }

  try {
    const tasks = await listTasks(
      String(req.params.id),
      req.tenantId,
      parsed.data as { status?: TaskStatus; priority?: Priority; assigneeId?: string; label?: string },
    );
    success(res, { tasks, total: tasks.length });
  } catch (err) {
    handleServiceError(err, res);
  }
}

/** GET /api/tasks/:id */
export async function getOne(req: Request, res: Response): Promise<void> {
  try {
    const task = await getTask(String(req.params.id), req.tenantId);
    success(res, { task });
  } catch (err) {
    handleServiceError(err, res);
  }
}

/** PATCH /api/tasks/:id */
export async function update(req: Request, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map(e => e.message).join(', '), 400);
    return;
  }

  try {
    const task = await updateTask({
      taskId: String(req.params.id),
      tenantId: req.tenantId,
      actorId: req.userId,
      ...parsed.data,
      description: parsed.data.description ?? undefined,
      assigneeId: parsed.data.assigneeId ?? undefined,
      dueDate: parsed.data.dueDate ?? undefined,
      estimatedHours: parsed.data.estimatedHours ?? undefined,
    });
    success(res, { task });
  } catch (err) {
    handleServiceError(err, res);
  }
}

/** PATCH /api/tasks/:id/status */
export async function updateStatus(req: Request, res: Response): Promise<void> {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'Valid status required: TODO | IN_PROGRESS | IN_REVIEW | DONE | CANCELLED', 400);
    return;
  }

  try {
    const task = await changeTaskStatus(
      String(req.params.id),
      req.tenantId,
      req.userId,
      parsed.data.status as TaskStatus,
    );
    success(res, { task });
  } catch (err) {
    handleServiceError(err, res);
  }
}

/** DELETE /api/tasks/:id */
export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await deleteTask(String(req.params.id), req.tenantId, req.userId);
    success(res, { message: 'Task deleted successfully' });
  } catch (err) {
    handleServiceError(err, res);
  }
}

/** GET /api/projects/:id/tasks/board */
export async function board(req: Request, res: Response): Promise<void> {
  try {
    const result = await getBoardView(String(req.params.id), req.tenantId);
    success(res, result);
  } catch (err) {
    handleServiceError(err, res);
  }
}
