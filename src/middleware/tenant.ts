import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { error } from '../utils/response';

/**
 * Validates that the tenant from the JWT token actually exists in the DB.
 * Attach after verifyToken so req.tenantId is already set.
 */
export async function validateTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
  if (!tenant) {
    error(res, 'Tenant not found', 404);
    return;
  }
  next();
}
