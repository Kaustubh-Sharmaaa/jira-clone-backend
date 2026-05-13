import 'dotenv/config';
import app from './app';
import { env } from './config/env';
import prisma from './config/prisma';

async function main() {
  // Verify DB connection
  await prisma.$connect();
  console.log('✅ Connected to PostgreSQL');

  app.listen(env.port, () => {
    console.log(`🚀 Server running on http://localhost:${env.port}`);
    console.log(`   Environment: ${env.nodeEnv}`);
    console.log(`   Health: http://localhost:${env.port}/health`);
  });
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down');
  await prisma.$disconnect();
  process.exit(0);
});
