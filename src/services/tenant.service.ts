import prisma from '../config/prisma';
import { hashPassword } from './auth.service';
import { Role } from '@prisma/client';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let attempt = 0;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    attempt++;
    slug = `${base}-${attempt}`;
  }
  return slug;
}

export interface RegisterTenantInput {
  tenantName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  timezone?: string;
}

export async function registerTenant(input: RegisterTenantInput) {
  const slug = await uniqueSlug(generateSlug(input.tenantName));

  // ✅ FIX: scope uniqueness check to the tenant being created.
  // The schema allows the same email in different tenants (@@unique([email, tenantId])).
  // A global findFirst was preventing cross-tenant reuse of emails — now removed.
  // Since this is a brand-new tenant, no users exist for it yet, so no additional check needed.

  const passwordHash = await hashPassword(input.adminPassword);

  const tenant = await prisma.tenant.create({
    data: {
      name: input.tenantName,
      slug,
      timezone: input.timezone ?? 'UTC',
      users: {
        create: {
          email: input.adminEmail,
          passwordHash,
          name: input.adminName,
          role: 'OWNER',
        },
      },
    },
    include: { users: true },
  });

  const admin = tenant.users[0];
  return { tenant, admin };
}

export interface RegisterUserInput {
  tenantSlug: string;
  email: string;
  password: string;
  name: string;
  role?: Role;
}

/**
 * Registers a new member into an existing tenant.
 * Throws TENANT_NOT_FOUND if the slug doesn't exist.
 * Throws EMAIL_TAKEN if the email is already used inside that tenant.
 */
export async function registerUserToTenant(input: RegisterUserInput) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: input.tenantSlug } });
  if (!tenant) throw new Error('TENANT_NOT_FOUND');

  const existing = await prisma.user.findUnique({
    where: { email_tenantId: { email: input.email, tenantId: tenant.id } },
  });
  if (existing) throw new Error('EMAIL_TAKEN');

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      role: input.role ?? 'MEMBER',
      tenantId: tenant.id,
    },
  });

  return { tenant, user };
}
