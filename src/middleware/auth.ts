import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { error } from '../utils/response';
import { Role } from '@prisma/client';

export function verifyToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    error(res, 'Missing or invalid authorization header', 401);
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    req.tenantId = payload.tenantId;
    req.userRole = payload.role;
    next();
  } catch {
    error(res, 'Invalid or expired token', 401);
  }
}

/**
 * RBAC middleware factory.
 * Usage: createRoleGuard('OWNER', 'ADMIN')
 * Roles are ranked: OWNER > ADMIN > MEMBER > VIEWER
 * A request passes if the user's role is in the allowed list.
 */
export function createRoleGuard(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!allowedRoles.includes(req.userRole)) {
      error(res, 'Insufficient permissions', 403);
      return;
    }
    next();
  };
}

// Alias for backwards compatibility
export const requireRoles = createRoleGuard;
