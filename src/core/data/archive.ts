import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { TenantScopeError, ValidationError } from '@/core/errors';

export const ARCHIVABLE_RESOURCES = ['CUSTOMER', 'LEAD', 'PRODUCT', 'EMPLOYEE'] as const;
export type ArchivableResource = (typeof ARCHIVABLE_RESOURCES)[number];

function assertResource(value: string): ArchivableResource {
  if (!ARCHIVABLE_RESOURCES.includes(value as ArchivableResource)) {
    throw new ValidationError('This resource type cannot be archived.');
  }
  return value as ArchivableResource;
}

async function findRecord(
  tx: Prisma.TransactionClient,
  organizationId: string,
  resourceType: ArchivableResource,
  resourceId: string,
) {
  switch (resourceType) {
    case 'CUSTOMER':
      return tx.customer.findFirst({ where: { id: resourceId, organizationId } });
    case 'LEAD':
      return tx.lead.findFirst({ where: { id: resourceId, organizationId } });
    case 'PRODUCT':
      return tx.product.findFirst({ where: { id: resourceId, organizationId } });
    case 'EMPLOYEE':
      return tx.employee.findFirst({ where: { id: resourceId, organizationId } });
  }
}

function archivedField(resourceType: ArchivableResource) {
  return { archivedAt: new Date() };
}

async function updateArchivedFlag(
  tx: Prisma.TransactionClient,
  organizationId: string,
  resourceType: ArchivableResource,
  resourceId: string,
  value: Date | null,
) {
  switch (resourceType) {
    case 'CUSTOMER':
      return tx.customer.updateMany({ where: { id: resourceId, organizationId }, data: { archivedAt: value } });
    case 'LEAD':
      return tx.lead.updateMany({ where: { id: resourceId, organizationId }, data: { archivedAt: value } });
    case 'PRODUCT':
      return tx.product.updateMany({ where: { id: resourceId, organizationId }, data: { archivedAt: value } });
    case 'EMPLOYEE':
      return tx.employee.updateMany({ where: { id: resourceId, organizationId }, data: { archivedAt: value } });
  }
}

export async function archiveRecord(input: {
  organizationId: string;
  actorUserId: string;
  resourceType: string;
  resourceId: string;
  reason?: string;
}) {
  const resourceType = assertResource(input.resourceType);
  return prisma.$transaction(async (tx) => {
    const record = await findRecord(tx, input.organizationId, resourceType, input.resourceId);
    if (!record) throw new TenantScopeError();

    const existing = await tx.archiveRecord.findUnique({
      where: {
        organizationId_resourceType_resourceId: {
          organizationId: input.organizationId,
          resourceType,
          resourceId: input.resourceId,
        },
      },
    });
    if (existing && !existing.restoredAt) {
      throw new ValidationError('This record is already archived.');
    }

    const snapshot = JSON.parse(
      JSON.stringify(record, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value instanceof Date ? value.toISOString() : value,
      ),
    ) as Prisma.InputJsonValue;

    await updateArchivedFlag(
      tx,
      input.organizationId,
      resourceType,
      input.resourceId,
      archivedField(resourceType).archivedAt,
    );

    if (existing) {
      return tx.archiveRecord.update({
        where: { id: existing.id },
        data: {
          archivedById: input.actorUserId,
          archivedAt: new Date(),
          restoredAt: null,
          restoredById: null,
          reason: input.reason?.slice(0, 500) ?? null,
          snapshot,
        },
      });
    }

    return tx.archiveRecord.create({
      data: {
        organizationId: input.organizationId,
        resourceType,
        resourceId: input.resourceId,
        archivedById: input.actorUserId,
        reason: input.reason?.slice(0, 500) ?? null,
        snapshot,
      },
    });
  });
}

export async function restoreRecord(input: {
  organizationId: string;
  actorUserId: string;
  archiveId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const archive = await tx.archiveRecord.findFirst({
      where: { id: input.archiveId, organizationId: input.organizationId },
    });
    if (!archive) throw new TenantScopeError();
    if (archive.restoredAt) throw new ValidationError('This record has already been restored.');

    const resourceType = assertResource(archive.resourceType);
    const record = await findRecord(tx, input.organizationId, resourceType, archive.resourceId);
    if (!record) throw new TenantScopeError();

    await updateArchivedFlag(
      tx,
      input.organizationId,
      resourceType,
      archive.resourceId,
      null,
    );
    return tx.archiveRecord.update({
      where: { id: archive.id },
      data: { restoredAt: new Date(), restoredById: input.actorUserId },
    });
  });
}

export async function listArchivedRecords(organizationId: string, take = 100) {
  return prisma.archiveRecord.findMany({
    where: { organizationId, restoredAt: null },
    orderBy: { archivedAt: 'desc' },
    take,
  });
}
