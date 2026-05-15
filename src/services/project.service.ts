import prisma from '../config/prisma';
import { Role } from '@prisma/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 10);
}

async function assertProjectInTenant(projectId: string, tenantId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.tenantId !== tenantId) throw new Error('PROJECT_NOT_FOUND');
  return project;
}

// ─── Create Project ───────────────────────────────────────────────────────────

export interface CreateProjectInput {
  name: string;
  description?: string;
  key: string; // e.g. 'SHOP' → stored as 'SHOP', validated unique per tenant
  tenantId: string;
  creatorId: string;
}

export async function createProject(input: CreateProjectInput) {
  const key = normalizeKey(input.key);
  if (!key) throw new Error('INVALID_KEY');

  const conflict = await prisma.project.findUnique({
    where: { key_tenantId: { key, tenantId: input.tenantId } },
  });
  if (conflict) throw new Error('KEY_TAKEN');

  const project = await prisma.project.create({
    data: {
      name: input.name,
      description: input.description,
      key,
      tenantId: input.tenantId,
      // Automatically add the creator as an OWNER-level member
      members: {
        create: { userId: input.creatorId, tenantId: input.tenantId, role: 'OWNER' },
      },
    },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
      _count: { select: { tasks: true, members: true } },
    },
  });

  return project;
}

// ─── List Projects ────────────────────────────────────────────────────────────

export async function listProjects(tenantId: string) {
  return prisma.project.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      key: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { members: true, tasks: true } },
    },
  });
}

// ─── Get Project Detail ───────────────────────────────────────────────────────

export async function getProject(projectId: string, tenantId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: {
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
        },
      },
      _count: { select: { tasks: true, members: true } },
    },
  });

  if (!project || project.tenantId !== tenantId) throw new Error('PROJECT_NOT_FOUND');
  return project;
}

// ─── Update Project ───────────────────────────────────────────────────────────

export interface UpdateProjectInput {
  projectId: string;
  tenantId: string;
  name?: string;
  description?: string;
  isArchived?: boolean;
}

export async function updateProject(input: UpdateProjectInput) {
  await assertProjectInTenant(input.projectId, input.tenantId);

  return prisma.project.update({
    where: { id: input.projectId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.isArchived !== undefined && { isArchived: input.isArchived }),
    },
    select: { id: true, name: true, description: true, key: true, isArchived: true, updatedAt: true },
  });
}

// ─── Archive Project (soft delete) ───────────────────────────────────────────

export async function archiveProject(projectId: string, tenantId: string) {
  await assertProjectInTenant(projectId, tenantId);

  return prisma.project.update({
    where: { id: projectId },
    data: { isArchived: true },
    select: { id: true, name: true, key: true, isArchived: true },
  });
}

// ─── Project Members ──────────────────────────────────────────────────────────

export async function listProjectMembers(projectId: string, tenantId: string) {
  await assertProjectInTenant(projectId, tenantId);

  return prisma.projectMember.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
    },
  });
}

export interface AddMemberInput {
  projectId: string;
  tenantId: string;
  userId: string;
  role?: Role;
}

export async function addProjectMember(input: AddMemberInput) {
  await assertProjectInTenant(input.projectId, input.tenantId);

  // Verify user belongs to this tenant
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.tenantId !== input.tenantId) throw new Error('USER_NOT_FOUND');
  if (!user.isActive) throw new Error('USER_INACTIVE');

  // Upsert: if already a member, update role; otherwise create
  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
    create: {
      projectId: input.projectId,
      userId: input.userId,
      tenantId: input.tenantId,
      role: input.role ?? 'MEMBER',
    },
    update: { role: input.role ?? 'MEMBER' },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  return member;
}

export async function removeProjectMember(
  projectId: string,
  targetUserId: string,
  tenantId: string,
  actorId: string,
) {
  await assertProjectInTenant(projectId, tenantId);

  // Cannot remove yourself
  if (targetUserId === actorId) throw new Error('CANNOT_REMOVE_SELF');

  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: targetUserId } },
  });
  if (!membership || membership.tenantId !== tenantId) throw new Error('MEMBER_NOT_FOUND');

  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId, userId: targetUserId } },
  });
}
