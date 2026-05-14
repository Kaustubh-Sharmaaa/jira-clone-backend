import crypto from 'crypto';
import prisma from '../config/prisma';
import { hashPassword } from './auth.service';
import { Role } from '@prisma/client';

// ─── Role hierarchy ───────────────────────────────────────────────────────────
// Used to prevent privilege escalation: an ADMIN cannot assign roles >= their own.
const ROLE_RANK: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

// ─── Invite ───────────────────────────────────────────────────────────────────

export interface InviteUserInput {
  email: string;
  role: Role;
  tenantId: string;
  invitedBy: string; // actorId for audit
}

/**
 * Creates a pending invitation for a user.
 * - Only one active (non-accepted, non-expired) invite per email per tenant.
 * - Returns the raw token (to be sent via email; logged to console in dev).
 */
export async function inviteUser(input: InviteUserInput) {
  const { email, role, tenantId } = input;

  // Check if user already exists in this tenant
  const existingUser = await prisma.user.findUnique({
    where: { email_tenantId: { email, tenantId } },
  });
  if (existingUser) throw new Error('USER_ALREADY_EXISTS');

  // Invalidate any previous pending invite for this email in this tenant
  await prisma.invitation.updateMany({
    where: { email, tenantId, accepted: false },
    data: { expiresAt: new Date() }, // expire immediately
  });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = await prisma.invitation.create({
    data: { email, role, tenantId, token: rawToken, expiresAt },
  });

  return { invitation, rawToken };
}

// ─── Accept Invite ────────────────────────────────────────────────────────────

export interface AcceptInviteInput {
  token: string;
  name: string;
  password: string;
}

export async function acceptInvite(input: AcceptInviteInput) {
  const { token, name, password } = input;

  const invitation = await prisma.invitation.findUnique({ where: { token } });

  if (!invitation) throw new Error('INVALID_TOKEN');
  if (invitation.accepted) throw new Error('INVITE_ALREADY_USED');
  if (invitation.expiresAt < new Date()) throw new Error('INVITE_EXPIRED');

  // Double-check the email isn't already registered (race condition guard)
  const existingUser = await prisma.user.findUnique({
    where: { email_tenantId: { email: invitation.email, tenantId: invitation.tenantId } },
  });
  if (existingUser) throw new Error('USER_ALREADY_EXISTS');

  const passwordHash = await hashPassword(password);

  const [user] = await prisma.$transaction([
    prisma.user.create({
      data: {
        email: invitation.email,
        name,
        passwordHash,
        role: invitation.role,
        tenantId: invitation.tenantId,
      },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { accepted: true },
    }),
  ]);

  const tenant = await prisma.tenant.findUnique({
    where: { id: invitation.tenantId },
    select: { id: true, name: true, slug: true, timezone: true },
  });

  return { user, tenant };
}

// ─── List Users ───────────────────────────────────────────────────────────────

export async function listUsers(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

// ─── Change Role ──────────────────────────────────────────────────────────────

export interface ChangeRoleInput {
  targetUserId: string;
  tenantId: string;
  actorId: string;
  actorRole: Role;
  newRole: Role;
}

export async function changeUserRole(input: ChangeRoleInput) {
  const { targetUserId, tenantId, actorId, actorRole, newRole } = input;

  if (targetUserId === actorId) throw new Error('CANNOT_MODIFY_SELF');

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target || target.tenantId !== tenantId) throw new Error('USER_NOT_FOUND');

  // Actor must outrank both the target's current role AND the new role
  if (!canManageRole(actorRole, target.role)) throw new Error('INSUFFICIENT_RANK');
  if (!canManageRole(actorRole, newRole)) throw new Error('INSUFFICIENT_RANK');

  // OWNER role can only be transferred by another OWNER
  if (newRole === 'OWNER' && actorRole !== 'OWNER') throw new Error('INSUFFICIENT_RANK');

  return prisma.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
    select: { id: true, email: true, name: true, role: true },
  });
}

// ─── Deactivate User ──────────────────────────────────────────────────────────

export interface DeactivateUserInput {
  targetUserId: string;
  tenantId: string;
  actorId: string;
  actorRole: Role;
}

export async function deactivateUser(input: DeactivateUserInput) {
  const { targetUserId, tenantId, actorId, actorRole } = input;

  if (targetUserId === actorId) throw new Error('CANNOT_DEACTIVATE_SELF');

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target || target.tenantId !== tenantId) throw new Error('USER_NOT_FOUND');

  // Actor must outrank the target
  if (!canManageRole(actorRole, target.role)) throw new Error('INSUFFICIENT_RANK');

  // Revoke all their sessions
  await prisma.refreshToken.updateMany({
    where: { userId: targetUserId, tenantId, isRevoked: false },
    data: { isRevoked: true },
  });

  return prisma.user.update({
    where: { id: targetUserId },
    data: { isActive: false },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
}
