import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { Role } from '@prisma/client';

export interface TokenPayload {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  role: Role;
  email: string;
  name: string;
  type: 'access' | 'refresh';
}

export function signAccessToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access', jti: randomUUID() }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh', jti: randomUUID() }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwt.accessSecret) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwt.refreshSecret) as TokenPayload;
}

export function refreshTokenExpiresAt(): Date {
  // 7 days from now
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}
