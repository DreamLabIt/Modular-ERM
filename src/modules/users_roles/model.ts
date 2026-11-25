import { prisma } from '@/core/db/prisma';
import bcrypt from 'bcryptjs';
import type { CreateRoleInput, CreateUserInput } from '@/core/types';

export async function createRole(input: CreateRoleInput) {
  await prisma.role.upsert({
    where: {
      organizationId_name: { organizationId: input.organizationId, name: input.name },
    },
    update: { permissions: input.permissions },
    create: {
      organizationId: input.organizationId,
      name: input.name,
      permissions: input.permissions.length > 0 ? input.permissions : ['hrm.view'],
    },
  });
}

export async function createUser(input: CreateUserInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return false;

  const role = await prisma.role.findFirst({
    where: { id: input.roleId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!role) return false;

  const passwordHash = await bcrypt.hash(input.password, 10);
  await prisma.user.create({
    data: {
      organizationId: input.organizationId,
      roleId: input.roleId,
      name: input.name,
      email: input.email,
      passwordHash,
    },
  });
  return true;
}

export async function listUsersAndRoles(organizationId: string) {
  return Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      include: { role: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.role.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    }),
  ]);
}
