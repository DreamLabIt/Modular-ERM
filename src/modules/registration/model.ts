import { prisma } from '@/core/db/prisma';
import { ROLE_PERMISSIONS, type RegisterOrganizationInput } from '@/core/types';

export async function isEmailRegistered(email: string) {
  return Boolean(await prisma.user.findUnique({ where: { email } }));
}

export async function registerOrganization(input: RegisterOrganizationInput) {
  const slug =
    input.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') +
    '-' +
    Math.floor(1000 + Math.random() * 9000);

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.companyName,
        slug,
        plan: input.selectedModules.length >= 6 ? 'ENTERPRISE' : 'PRO',
      },
    });

    const adminRole = await tx.role.create({
      data: {
        organizationId: org.id,
        name: 'Admin',
        permissions: [...ROLE_PERMISSIONS.Admin],
        isSystem: true,
      },
    });

    await tx.role.createMany({
      data: [
        {
          organizationId: org.id,
          name: 'Manager',
          permissions: [...ROLE_PERMISSIONS.Manager],
          isSystem: true,
        },
        {
          organizationId: org.id,
          name: 'Employee',
          permissions: [...ROLE_PERMISSIONS.Employee],
          isSystem: true,
        },
      ],
    });

    await tx.user.create({
      data: {
        organizationId: org.id,
        roleId: adminRole.id,
        name: input.ownerName,
        email: input.email,
        passwordHash: input.passwordHash,
      },
    });

    const modulesToEnable =
      input.selectedModules.length > 0 ? input.selectedModules : ['inventory', 'sales_purchase'];
    for (const moduleKey of modulesToEnable) {
      await tx.organizationModule.create({
        data: { organizationId: org.id, moduleKey, isEnabled: true },
      });
    }

    await tx.warehouse.create({
      data: { organizationId: org.id, name: 'Main Warehouse', location: 'Head Office' },
    });
  });
}
