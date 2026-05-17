import prisma from '../config/prisma';
import { TaskStatus, Priority } from '@prisma/client';

// ─── Shared select for task lists ─────────────────────────────────────────────
const TASK_SELECT = {
  id: true,
  taskKey: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  labels: true,
  dueDate: true,
  estimatedHours: true,
  taskOrder: true,
  createdAt: true,
  updatedAt: true,
  projectId: true,
  tenantId: true,
  assignee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function assertTaskInTenant(taskId: string, tenantId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.tenantId !== tenantId || task.isDeleted) throw new Error('TASK_NOT_FOUND');
  return task;
}

async function assertProjectInTenant(projectId: string, tenantId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.tenantId !== tenantId || project.isArchived) throw new Error('PROJECT_NOT_FOUND');
  return project;
}

/** Auto-generate next task key: SHOP-1, SHOP-2, ... */
async function generateTaskKey(projectId: string, projectKey: string): Promise<string> {
  // Find the highest-numbered key for this project (including soft-deleted, so keys are never reused)
  const last = await prisma.task.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: { taskKey: true },
  });

  let nextNum = 1;
  if (last) {
    const parts = last.taskKey.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) nextNum = num + 1;
  }

  return `${projectKey}-${nextNum}`;
}

// ─── Create Task ──────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  projectId: string;
  tenantId: string;
  reporterId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  assigneeId?: string;
  dueDate?: string;
  estimatedHours?: number;
  labels?: string[];
  parentTaskId?: string;
  sprintId?: string;
}

export async function createTask(input: CreateTaskInput) {
  const project = await assertProjectInTenant(input.projectId, input.tenantId);
  const taskKey = await generateTaskKey(input.projectId, project.key);

  // Get the current max order for this project+status column
  const maxOrder = await prisma.task.aggregate({
    where: { projectId: input.projectId, status: input.status ?? 'TODO', isDeleted: false },
    _max: { taskOrder: true },
  });
  const taskOrder = (maxOrder._max.taskOrder ?? -1) + 1;

  return prisma.task.create({
    data: {
      taskKey,
      title: input.title,
      description: input.description,
      status: input.status ?? 'TODO',
      priority: input.priority ?? 'MEDIUM',
      labels: input.labels ?? [],
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      estimatedHours: input.estimatedHours,
      taskOrder,
      projectId: input.projectId,
      tenantId: input.tenantId,
      reporterId: input.reporterId,
      assigneeId: input.assigneeId,
      parentTaskId: input.parentTaskId,
      sprintId: input.sprintId,
    },
    select: { ...TASK_SELECT, parentTaskId: true, sprintId: true },
  });
}

// ─── List Tasks ───────────────────────────────────────────────────────────────

export interface ListTasksFilter {
  status?: TaskStatus;
  priority?: Priority;
  assigneeId?: string;
  label?: string;
}

export async function listTasks(projectId: string, tenantId: string, filters: ListTasksFilter = {}) {
  await assertProjectInTenant(projectId, tenantId);

  return prisma.task.findMany({
    where: {
      projectId,
      tenantId,
      isDeleted: false,
      ...(filters.status && { status: filters.status }),
      ...(filters.priority && { priority: filters.priority }),
      ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
      ...(filters.label && { labels: { has: filters.label } }),
    },
    select: TASK_SELECT,
    orderBy: [{ status: 'asc' }, { taskOrder: 'asc' }, { createdAt: 'desc' }],
  });
}

// ─── Get Single Task ──────────────────────────────────────────────────────────

export async function getTask(taskId: string, tenantId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      ...TASK_SELECT,
      isDeleted: true,
      parentTaskId: true,
      sprintId: true,
      subTasks: { where: { isDeleted: false }, select: { id: true, taskKey: true, title: true, status: true, priority: true } },
      comments: {
        where: {},
        orderBy: { createdAt: 'asc' },
        select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true, email: true } } },
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, field: true, oldValue: true, newValue: true, createdAt: true,
          actor: { select: { id: true, name: true } } },
      },
    },
  });

  if (!task || task.tenantId !== tenantId || task.isDeleted) throw new Error('TASK_NOT_FOUND');
  return task;
}

// ─── Update Task ──────────────────────────────────────────────────────────────

export interface UpdateTaskInput {
  taskId: string;
  tenantId: string;
  actorId: string;
  title?: string;
  description?: string;
  priority?: Priority;
  assigneeId?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  labels?: string[];
  taskOrder?: number;
}

export async function updateTask(input: UpdateTaskInput) {
  const existing = await assertTaskInTenant(input.taskId, input.tenantId);

  const updated = await prisma.task.update({
    where: { id: input.taskId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
      ...(input.dueDate !== undefined && { dueDate: input.dueDate ? new Date(input.dueDate) : null }),
      ...(input.estimatedHours !== undefined && { estimatedHours: input.estimatedHours }),
      ...(input.labels !== undefined && { labels: input.labels }),
      ...(input.taskOrder !== undefined && { taskOrder: input.taskOrder }),
    },
    select: TASK_SELECT,
  });

  // Log field changes in activity
  const fieldsToTrack: Array<keyof typeof input> = ['title', 'priority', 'assigneeId', 'dueDate'];
  for (const field of fieldsToTrack) {
    const newVal = input[field];
    const oldVal = (existing as Record<string, unknown>)[field];
    if (newVal !== undefined && String(newVal) !== String(oldVal)) {
      await prisma.activity.create({
        data: {
          taskId: input.taskId,
          actorId: input.actorId,
          tenantId: input.tenantId,
          type: 'FIELD_CHANGE',
          field,
          oldValue: oldVal != null ? String(oldVal) : null,
          newValue: newVal != null ? String(newVal) : null,
        },
      });
    }
  }

  return updated;
}

// ─── Change Status ────────────────────────────────────────────────────────────

export async function changeTaskStatus(
  taskId: string,
  tenantId: string,
  actorId: string,
  newStatus: TaskStatus,
) {
  const existing = await assertTaskInTenant(taskId, tenantId);
  if (existing.status === newStatus) throw new Error('STATUS_UNCHANGED');

  const [task] = await prisma.$transaction([
    prisma.task.update({
      where: { id: taskId },
      data: { status: newStatus },
      select: TASK_SELECT,
    }),
    prisma.activity.create({
      data: {
        taskId,
        actorId,
        tenantId,
        type: 'STATUS_CHANGE',
        field: 'status',
        oldValue: existing.status,
        newValue: newStatus,
      },
    }),
  ]);

  return task;
}

// ─── Soft Delete ──────────────────────────────────────────────────────────────

export async function deleteTask(taskId: string, tenantId: string, actorId: string) {
  await assertTaskInTenant(taskId, tenantId);

  await prisma.task.update({
    where: { id: taskId },
    data: { isDeleted: true },
  });

  await prisma.activity.create({
    data: {
      taskId,
      actorId,
      tenantId,
      type: 'TASK_DELETED',
      field: null,
      oldValue: null,
      newValue: null,
    },
  });
}

// ─── Board View ───────────────────────────────────────────────────────────────

const BOARD_COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'];

export async function getBoardView(projectId: string, tenantId: string) {
  await assertProjectInTenant(projectId, tenantId);

  const tasks = await prisma.task.findMany({
    where: { projectId, tenantId, isDeleted: false },
    select: TASK_SELECT,
    orderBy: { taskOrder: 'asc' },
  });

  const board: Record<TaskStatus, typeof tasks> = {
    TODO: [],
    IN_PROGRESS: [],
    IN_REVIEW: [],
    DONE: [],
    CANCELLED: [],
  };

  for (const task of tasks) {
    board[task.status].push(task);
  }

  return {
    board,
    columnCounts: Object.fromEntries(BOARD_COLUMNS.map(col => [col, board[col].length])),
  };
}
