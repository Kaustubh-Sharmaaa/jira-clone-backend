import { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      tenantId: string;
      userId: string;
      userRole: Role;
    }
  }
}

export {};
