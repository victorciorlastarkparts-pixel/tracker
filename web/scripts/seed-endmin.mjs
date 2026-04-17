import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
  return value.trim();
}

async function main() {
  const username = requiredEnv('ADMIN_USERNAME');
  const password = requiredEnv('ADMIN_PASSWORD');
  const id = requiredEnv('ADMIN_USER_ID');
  const email = requiredEnv('ADMIN_EMAIL');

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { username },
    update: {
      passwordHash,
      email,
      role: 'ADMIN'
    },
    create: {
      id,
      username,
      email,
      passwordHash,
      role: 'ADMIN'
    }
  });

  console.log(`Usuario administrativo ${username} criado/atualizado com sucesso.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
