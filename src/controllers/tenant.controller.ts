import { Request, Response } from 'express';
import { z } from 'zod';
import { registerTenant } from '../services/tenant.service';
import { issueTokenPair } from '../services/auth.service';
import { created, error } from '../utils/response';

const registerSchema = z.object({
  tenantName: z.string().min(2).max(100),
  adminName: z.string().min(1).max(100),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  timezone: z.string().optional(),
});

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((e: { message: string }) => e.message).join(', '), 400);
    return;
  }

  try {
    const { tenant, admin } = await registerTenant(parsed.data);
    const { accessToken, refreshToken } = await issueTokenPair({
      ...admin,
      tenantSlug: tenant.slug,
    });

    created(res, {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        timezone: tenant.timezone,
      },
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
      tokens: { accessToken, refreshToken },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_TAKEN') {
      error(res, 'Email is already registered', 409);
    } else {
      error(res, 'Internal server error', 500);
    }
  }
}
