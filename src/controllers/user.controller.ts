import { Request, Response } from 'express';
import { z } from 'zod';
import { success, created, error } from '../utils/response';
import { issueTokenPair } from '../services/auth.service';
import {
  inviteUser,
  acceptInvite,
  checkInvite,
  listUsers,
  changeUserRole,
  deactivateUser,
} from '../services/user.service';
import { env } from '../config/env';
import prisma from '../config/prisma';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(100).optional(), // required for new users, auto-resolved for existing
  password: z.string().min(8),
});

const changeRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/users/invite — OWNER or ADMIN only
 * Creates a pending invitation for a new user.
 */
export async function invite(req: Request, res: Response): Promise<void> {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  const { email, role } = parsed.data;

  // ADMINs cannot invite another ADMIN (OWNER is already excluded by the schema enum)
  const roleAsString = role as string;
  if (req.userRole === 'ADMIN' && roleAsString === 'ADMIN') {
    error(res, 'Admins can only invite MEMBER or VIEWER roles', 403);
    return;
  }

  try {
    const { invitation, rawToken, isExistingUser, existingName } = await inviteUser({
      email,
      role,
      tenantId: req.tenantId,
      invitedBy: req.userId,
    });

    const isDev = env.nodeEnv !== 'production';
    const responseData: Record<string, unknown> = {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        isExistingUser,
        expiresAt: invitation.expiresAt,
      },
    };

    if (isDev) {
      console.log(`[DEV] Invite token for ${email}: ${rawToken}`);
      responseData.devToken = rawToken;
    }

    created(res, responseData);
  } catch (err) {
    if (err instanceof Error && err.message === 'USER_ALREADY_EXISTS') {
      error(res, 'User with this email already exists in this workspace', 409);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}

/**
 * GET /api/users/check-invite/:token — public
 * Returns invite metadata so the frontend knows which form to show.
 */
export async function checkInviteHandler(req: Request, res: Response): Promise<void> {
  try {
    const data = await checkInvite(String(req.params.token));
    success(res, data);
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg === 'INVALID_TOKEN') return void error(res, 'Invite token is invalid', 400);
      if (msg === 'INVITE_ALREADY_USED') return void error(res, 'Invite has already been used', 400);
      if (msg === 'INVITE_EXPIRED') return void error(res, 'Invite has expired', 400);
    }
    error(res, 'Internal server error', 500);
  }
}

/**
 * POST /api/users/accept-invite — public
 * User sets their name + password and activates their account.
 */
export async function acceptInviteHandler(req: Request, res: Response): Promise<void> {
  const parsed = acceptInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  try {
    const { user, tenant, isExistingUser } = await acceptInvite(parsed.data);
    const { accessToken, refreshToken } = await issueTokenPair({
      ...user,
      tenantSlug: tenant!.slug,
    });

    created(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: tenant!.slug,
        isExistingUser,
      },
      tokens: { accessToken, refreshToken },
    });
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg === 'INVALID_TOKEN') return void error(res, 'Invite token is invalid', 400);
      if (msg === 'INVITE_ALREADY_USED') return void error(res, 'Invite has already been used', 400);
      if (msg === 'INVITE_EXPIRED') return void error(res, 'Invite has expired', 400);
      if (msg === 'USER_ALREADY_EXISTS') return void error(res, 'Account already exists in this workspace', 409);
      if (msg === 'NAME_REQUIRED') return void error(res, 'Name is required for new users', 400);
    }
    error(res, 'Internal server error', 500);
  }
}

/**
 * GET /api/users — OWNER or ADMIN only
 * Lists all users in the current tenant.
 */
export async function getUsers(req: Request, res: Response): Promise<void> {
  const users = await listUsers(req.tenantId);
  success(res, { users, total: users.length });
}

/**
 * PATCH /api/users/:id/role — OWNER or ADMIN only
 * Changes a user's role with rank-based enforcement.
 */
export async function updateRole(req: Request, res: Response): Promise<void> {
  const parsed = changeRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  try {
    const user = await changeUserRole({
      targetUserId: String(req.params.id),
      tenantId: req.tenantId,
      actorId: req.userId,
      actorRole: req.userRole,
      newRole: parsed.data.role,
    });
    success(res, { user });
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg === 'USER_NOT_FOUND') return void error(res, 'User not found', 404);
      if (msg === 'CANNOT_MODIFY_SELF') return void error(res, 'Cannot change your own role', 400);
      if (msg === 'INSUFFICIENT_RANK') return void error(res, 'Insufficient permissions to assign this role', 403);
    }
    error(res, 'Internal server error', 500);
  }
}

/**
 * DELETE /api/users/:id — OWNER or ADMIN only
 * Deactivates a user (soft delete). Cannot deactivate self.
 */
export async function deactivate(req: Request, res: Response): Promise<void> {
  try {
    const user = await deactivateUser({
      targetUserId: String(req.params.id),
      tenantId: req.tenantId,
      actorId: req.userId,
      actorRole: req.userRole,
    });
    success(res, { user, message: 'User deactivated successfully' });
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg === 'USER_NOT_FOUND') return void error(res, 'User not found', 404);
      if (msg === 'CANNOT_DEACTIVATE_SELF') return void error(res, 'Cannot deactivate your own account', 400);
      if (msg === 'INSUFFICIENT_RANK') return void error(res, 'Insufficient permissions to deactivate this user', 403);
    }
    error(res, 'Internal server error', 500);
  }
}
