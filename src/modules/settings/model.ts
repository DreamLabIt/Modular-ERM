import { prisma } from '@/core/db/prisma';
import type { UpdateBrandingInput } from '@/core/types';

export async function updateBranding(input: UpdateBrandingInput) {
  await prisma.organization.update({
    where: { id: input.organizationId },
    data: {
      name: input.name,
      primaryColor: input.primaryColor,
      currency: input.currency,
      address: input.address,
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
    },
  });
}

export async function setModuleEnabled(organizationId: string, moduleKey: string, enable: boolean) {
  await prisma.organizationModule.upsert({
    where: { organizationId_moduleKey: { organizationId, moduleKey } },
    update: { isEnabled: enable },
    create: { organizationId, moduleKey, isEnabled: enable },
  });
}
