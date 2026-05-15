import { Request, Response } from 'express';
import { z } from 'zod';
import { success, created, error } from '../utils/response';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  archiveProject,
  listProjectMembers,
  addProjectMember,
  removeProjectMember,
} from '../services/project.service';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  key: z.string().min(1).max(10),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  isArchived: z.boolean().optional(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).optional(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  try {
    const project = await createProject({
      ...parsed.data,
      tenantId: req.tenantId,
      creatorId: req.userId,
    });
    created(res, { project });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'KEY_TAKEN') return void error(res, 'Project key already in use in this workspace', 409);
      if (err.message === 'INVALID_KEY') return void error(res, 'Project key must contain at least one alphanumeric character', 400);
    }
    error(res, 'Internal server error', 500);
  }
}

export async function list(req: Request, res: Response): Promise<void> {
  const projects = await listProjects(req.tenantId);
  success(res, { projects, total: projects.length });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  try {
    const project = await getProject(String(req.params.id), req.tenantId);
    success(res, { project });
  } catch (err) {
    if (err instanceof Error && err.message === 'PROJECT_NOT_FOUND') {
      error(res, 'Project not found', 404);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  try {
    const project = await updateProject({
      projectId: String(req.params.id),
      tenantId: req.tenantId,
      ...parsed.data,
      description: parsed.data.description ?? undefined,
    });
    success(res, { project });
  } catch (err) {
    if (err instanceof Error && err.message === 'PROJECT_NOT_FOUND') {
      error(res, 'Project not found', 404);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}

export async function archive(req: Request, res: Response): Promise<void> {
  try {
    const project = await archiveProject(String(req.params.id), req.tenantId);
    success(res, { project, message: 'Project archived successfully' });
  } catch (err) {
    if (err instanceof Error && err.message === 'PROJECT_NOT_FOUND') {
      error(res, 'Project not found', 404);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}

export async function getMembers(req: Request, res: Response): Promise<void> {
  try {
    const members = await listProjectMembers(String(req.params.id), req.tenantId);
    success(res, { members, total: members.length });
  } catch (err) {
    if (err instanceof Error && err.message === 'PROJECT_NOT_FOUND') {
      error(res, 'Project not found', 404);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}

export async function addMember(req: Request, res: Response): Promise<void> {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  try {
    const member = await addProjectMember({
      projectId: String(req.params.id),
      tenantId: req.tenantId,
      userId: parsed.data.userId,
      role: parsed.data.role,
    });
    created(res, { member });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'PROJECT_NOT_FOUND') return void error(res, 'Project not found', 404);
      if (err.message === 'USER_NOT_FOUND') return void error(res, 'User not found in this workspace', 404);
      if (err.message === 'USER_INACTIVE') return void error(res, 'Cannot add an inactive user', 400);
    }
    error(res, 'Internal server error', 500);
  }
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  try {
    await removeProjectMember(
      String(req.params.id),
      String(req.params.userId),
      req.tenantId,
      req.userId,
    );
    success(res, { message: 'Member removed from project' });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'PROJECT_NOT_FOUND') return void error(res, 'Project not found', 404);
      if (err.message === 'MEMBER_NOT_FOUND') return void error(res, 'Member not found in this project', 404);
      if (err.message === 'CANNOT_REMOVE_SELF') return void error(res, 'Cannot remove yourself from a project', 400);
    }
    error(res, 'Internal server error', 500);
  }
}
