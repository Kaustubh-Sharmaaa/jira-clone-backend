import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import {
  comparePassword,
  hashPassword,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  generatePasswordResetToken,
  resetPassword,
} from '../services/auth.service';
import { registerUserToTenant } from '../services/tenant.service';
import { success, created, error } from '../utils/response';
import { env } from '../config/env';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSlug: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const registerSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  role: z.enum(['MEMBER', 'VIEWER']).optional(), // only safe roles allowed on self-register
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  const { email, password, tenantSlug } = parsed.data;

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    error(res, 'Invalid credentials', 401);
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email_tenantId: { email, tenantId: tenant.id } },
  });

  if (!user || !user.isActive) {
    error(res, 'Invalid credentials', 401);
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    error(res, 'Invalid credentials', 401);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const { accessToken, refreshToken } = await issueTokenPair({
    ...user,
    tenantSlug: tenant.slug,
  });

  success(res, {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      tenantSlug: tenant.slug,
    },
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  try {
    const { tenant, user } = await registerUserToTenant(parsed.data);
    const { accessToken, refreshToken } = await issueTokenPair({
      ...user,
      tenantSlug: tenant.slug,
    });

    created(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: tenant.slug,
      },
      tokens: { accessToken, refreshToken },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'TENANT_NOT_FOUND') {
      error(res, 'Tenant not found', 404);
    } else if (err instanceof Error && err.message === 'EMAIL_TAKEN') {
      error(res, 'Email is already registered in this workspace', 409);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'refreshToken is required', 400);
    return;
  }

  try {
    const { accessToken, refreshToken } = await rotateRefreshToken(parsed.data.refreshToken);
    success(res, { accessToken, refreshToken });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_TOKEN') {
      error(res, 'Invalid or expired refresh token', 401);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'refreshToken is required', 400);
    return;
  }

  await revokeRefreshToken(parsed.data.refreshToken);
  success(res, { message: 'Logged out successfully' });
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  await revokeAllRefreshTokens(req.userId, req.tenantId);
  success(res, { message: 'All sessions revoked successfully' });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      tenant: { select: { id: true, name: true, slug: true, timezone: true } },
    },
  });

  if (!user || user.tenantId !== req.tenantId) {
    error(res, 'User not found', 404);
    return;
  }

  success(res, user);
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  const { email, tenantSlug } = parsed.data;

  try {
    const { rawToken } = await generatePasswordResetToken(email, tenantSlug);

    // ── In production, send rawToken via email ──
    // await mailer.sendPasswordReset({ to: email, token: rawToken });

    // Dev: surface the token in the response so you can test without SMTP
    const isDev = env.nodeEnv !== 'production';
    const responseData: Record<string, unknown> = {
      message: 'If that email exists in this workspace, a reset link has been sent.',
    };
    if (isDev) {
      console.log(`[DEV] Password reset token for ${email}: ${rawToken}`);
      responseData.devToken = rawToken; // remove this field in production
    }

    success(res, responseData);
  } catch {
    // Always respond with 200 to prevent user enumeration
    success(res, {
      message: 'If that email exists in this workspace, a reset link has been sent.',
    });
  }
}

export async function resetPasswordHandler(req: Request, res: Response): Promise<void> {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  try {
    await resetPassword(parsed.data.token, parsed.data.newPassword);
    success(res, { message: 'Password reset successfully. Please log in with your new password.' });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_TOKEN') {
      error(res, 'Reset token is invalid or has expired', 400);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user || user.tenantId !== req.tenantId) {
    error(res, 'User not found', 404);
    return;
  }

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    error(res, 'Current password is incorrect', 400);
    return;
  }

  if (currentPassword === newPassword) {
    error(res, 'New password must be different from the current password', 400);
    return;
  }

  const newHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

  success(res, { message: 'Password changed successfully' });
}
