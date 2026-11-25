import { prisma } from '@/core/db/prisma';

export async function findUserForCredentials(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: { role: true, organization: true },
  });
}

export async function findTenantOrganization(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    include: { modules: { where: { isEnabled: true } } },
  });
}
