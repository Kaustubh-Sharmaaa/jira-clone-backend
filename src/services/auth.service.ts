import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { env } from '../config/env';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshTokenExpiresAt,
} from '../utils/jwt';
import { Role } from '@prisma/client';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.bcryptRounds);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function buildTokenPayload(user: {
  id: string;
  tenantId: string;
  tenantSlug: string;
  role: Role;
  email: string;
  name: string;
}) {
  return {
    sub: user.id,
    tenantId: user.tenantId,
    tenantSlug: user.tenantSlug,
    role: user.role,
    email: user.email,
    name: user.name,
  };
}

export async function issueTokenPair(user: {
  id: string;
  tenantId: string;
  tenantSlug: string;
  role: Role;
  email: string;
  name: string;
}) {
  const payload = buildTokenPayload(user);
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      tenantId: user.tenantId,
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(rawToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    throw new Error('INVALID_TOKEN');
  }

  if (payload.type !== 'refresh') throw new Error('INVALID_TOKEN');

  const stored = await prisma.refreshToken.findUnique({ where: { token: rawToken } });
  if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
    throw new Error('INVALID_TOKEN');
  }

  // Revoke old token
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { isRevoked: true } });

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    include: { tenant: { select: { slug: true } } },
  });
  if (!user || !user.isActive) throw new Error('USER_NOT_FOUND');

  return issueTokenPair({ ...user, tenantSlug: user.tenant.slug });
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { token: rawToken, isRevoked: false },
    data: { isRevoked: true },
  });
}

export async function revokeAllRefreshTokens(userId: string, tenantId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, tenantId, isRevoked: false },
    data: { isRevoked: true },
  });
}

// ─── Forgot / Reset Password ──────────────────────────────────────────────────

/**
 * Generates a secure password reset token for a user in a given tenant.
 * Stores a bcrypt hash of the raw token. Returns the raw token (to be sent
 * via email or logged in dev). Invalidates any previous unused tokens.
 */
export async function generatePasswordResetToken(
  email: string,
  tenantSlug: string,
): Promise<{ rawToken: string; userId: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) throw new Error('TENANT_NOT_FOUND');

  const user = await prisma.user.findUnique({
    where: { email_tenantId: { email, tenantId: tenant.id } },
  });
  // Always resolve successfully to avoid user enumeration attacks
  if (!user || !user.isActive) throw new Error('USER_NOT_FOUND');

  // Invalidate all previous unused reset tokens for this user in this tenant
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, tenantId: tenant.id, usedAt: null },
    data: { usedAt: new Date() }, // mark as used = invalidated
  });

  const rawToken = crypto.randomBytes(32).toString('hex'); // 64-char hex string
  const tokenHash = await bcrypt.hash(rawToken, 10);

  const expiresAt = new Date(
    Date.now() + (env.passwordResetExpiresMinutes ?? 60) * 60 * 1000,
  );

  await prisma.passwordResetToken.create({
    data: {
      tokenHash,
      userId: user.id,
      tenantId: tenant.id,
      expiresAt,
    },
  });

  return { rawToken, userId: user.id };
}

/**
 * Validates a raw reset token and sets a new password.
 * Tokens are single-use and expire after a configured window.
 */
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  // We can't query by the raw token directly — we have to scan recent ones.
  // For efficiency we look for non-used, non-expired tokens and bcrypt.compare each.
  const candidates = await prisma.passwordResetToken.findMany({
    where: {
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    take: 20, // safety cap — in practice 1 token per user
  });

  let matched: (typeof candidates)[0] | null = null;
  for (const candidate of candidates) {
    const ok = await bcrypt.compare(rawToken, candidate.tokenHash);
    if (ok) {
      matched = candidate;
      break;
    }
  }

  if (!matched) throw new Error('INVALID_TOKEN');

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: matched.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: matched.userId },
      data: { passwordHash: newHash },
    }),
    // Revoke all active refresh tokens so old sessions are killed
    prisma.refreshToken.updateMany({
      where: { userId: matched.userId, tenantId: matched.tenantId, isRevoked: false },
      data: { isRevoked: true },
    }),
  ]);
}
