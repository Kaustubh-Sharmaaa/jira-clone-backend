import 'dotenv/config';
import prisma from '../src/config/prisma';
import { registerTenant } from '../src/services/tenant.service';

const tenants = [
  {
    tenantName: 'Acme Corp',
    adminName: 'Alice Johnson',
    adminEmail: 'alice@acme.com',
    adminPassword: 'Password123!',
    timezone: 'America/New_York',
  },
  {
    tenantName: 'Beta Startup',
    adminName: 'Bob Smith',
    adminEmail: 'bob@beta.com',
    adminPassword: 'Password123!',
    timezone: 'Europe/London',
  },
];

async function seed() {
  console.log('🌱 Seeding database...');

  for (const input of tenants) {
    const existing = await prisma.tenant.findUnique({ where: { slug: input.tenantName.toLowerCase().replace(/\s+/g, '-') } });
    if (existing) {
      console.log(`   ⚠️  Tenant "${input.tenantName}" already exists, skipping`);
      continue;
    }

    const { tenant, admin } = await registerTenant(input);
    console.log(`   ✅ Created tenant: ${tenant.name} (slug: ${tenant.slug})`);
    console.log(`      Admin: ${admin.email} / Password123!`);
  }

  console.log('✅ Seed complete');
}

seed()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
