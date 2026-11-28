import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { ValidationError } from '@/core/errors';
import { recordAuditLog } from '@/core/audit';

export const RETENTION_DATA_TYPES = [
  'AUDIT_LOG',
  'LOGIN_HISTORY',
  'NOTIFICATION_HISTORY',
  'IMPORT_EXPORT_FILES',
  'SESSION_HISTORY',
] as const;
export type RetentionDataType = (typeof RETENTION_DATA_TYPES)[number];
export type RetentionAction = 'DELETE' | 'ANONYMIZE' | 'ARCHIVE';

export function assertRetentionPolicy(values: {
  dataType?: string;
  retentionDays?: number;
  action?: string;
}) {
  if (values.dataType && !RETENTION_DATA_TYPES.includes(values.dataType as RetentionDataType)) {
    throw new ValidationError('Unsupported retention data type.');
  }
  if (
    values.retentionDays !== undefined &&
    (!Number.isInteger(values.retentionDays) || values.retentionDays < 30 || values.retentionDays > 3650)
  ) {
    throw new ValidationError('Retention period must be between 30 and 3650 days.');
  }
  if (values.action && !['DELETE', 'ANONYMIZE', 'ARCHIVE'].includes(values.action)) {
    throw new ValidationError('Unsupported retention action.');
  }
}

export async function listRetentionPolicies(organizationId: string) {
  const existing = await prisma.dataRetentionPolicy.findMany({
    where: { organizationId },
    orderBy: { dataType: 'asc' },
  });
  const byType = new Map(existing.map((policy) => [policy.dataType, policy]));
  return RETENTION_DATA_TYPES.map((dataType) => ({
    dataType,
    id: byType.get(dataType)?.id ?? null,
    retentionDays: byType.get(dataType)?.retentionDays ?? 365,
    action: (byType.get(dataType)?.action ?? 'DELETE') as RetentionAction,
    isActive: byType.get(dataType)?.isActive ?? false,
    legalHold: byType.get(dataType)?.legalHold ?? false,
  }));
}

export async function upsertRetentionPolicy(input: {
  organizationId: string;
  dataType: string;
  retentionDays: number;
  action: string;
  isActive: boolean;
  legalHold?: boolean;
}) {
  assertRetentionPolicy(input);
  const dataType = input.dataType as RetentionDataType;
  const action = input.action as RetentionAction;
  const existing = await prisma.dataRetentionPolicy.findUnique({
    where: { organizationId_dataType: { organizationId: input.organizationId, dataType } },
  });
  return prisma.dataRetentionPolicy.upsert({
    where: { organizationId_dataType: { organizationId: input.organizationId, dataType } },
    update: {
      retentionDays: input.retentionDays,
      action,
      isActive: Boolean(input.isActive),
      ...(input.legalHold !== undefined ? { legalHold: Boolean(input.legalHold) } : {}),
    },
    create: {
      organizationId: input.organizationId,
      dataType,
      retentionDays: input.retentionDays,
      action,
      isActive: Boolean(input.isActive),
      legalHold: Boolean(input.legalHold ?? false),
    },
  }).then(async (policy) => {
    if (existing?.legalHold && !policy.legalHold) {
      await recordAuditLog({
        organizationId: input.organizationId,
        action: 'LEGAL_HOLD_REMOVED',
        resource: 'RETENTION_POLICY',
        resourceId: policy.id,
        description: `Legal hold removed for ${dataType}.`,
      });
    }
    return policy;
  });
}

async function applyPolicy(
  organizationId: string,
  dataType: RetentionDataType,
  action: RetentionAction,
  cutoff: Date,
  actorUserId: string | null,
) {
  switch (dataType) {
    case 'AUDIT_LOG':
      if (action === 'DELETE') {
        const result = await prisma.auditLog.deleteMany({
          where: { organizationId, createdAt: { lt: cutoff } },
        });
        return { deletedCount: result.count, archivedCount: 0, skippedCount: 0 };
      }
      return { deletedCount: 0, archivedCount: 0, skippedCount: 1 };

    case 'LOGIN_HISTORY':
      if (action === 'ANONYMIZE') {
        const result = await prisma.loginHistory.updateMany({
          where: { organizationId, createdAt: { lt: cutoff } },
          data: {
            email: 'redacted@example.invalid',
            ipAddress: null,
            userAgent: null,
            device: null,
          },
        });
        return { deletedCount: 0, archivedCount: 0, skippedCount: result.count };
      }
      if (action === 'DELETE') {
        const result = await prisma.loginHistory.deleteMany({
          where: { organizationId, createdAt: { lt: cutoff } },
        });
        return { deletedCount: result.count, archivedCount: 0, skippedCount: 0 };
      }
      return { deletedCount: 0, archivedCount: 0, skippedCount: 1 };

    case 'NOTIFICATION_HISTORY': {
      const result = await prisma.notification.deleteMany({
        where: { organizationId, createdAt: { lt: cutoff } },
      });
      return { deletedCount: result.count, archivedCount: 0, skippedCount: 0 };
    }

    case 'SESSION_HISTORY': {
      const result = await prisma.userSession.deleteMany({
        where: { organizationId, createdAt: { lt: cutoff }, revokedAt: { not: null } },
      });
      return { deletedCount: result.count, archivedCount: 0, skippedCount: 0 };
    }

    case 'IMPORT_EXPORT_FILES':
      // Handled by purgeExpiredExports() so filesystem artifacts are removed too.
      return { deletedCount: 0, archivedCount: 0, skippedCount: 1 };

    default:
      return { deletedCount: 0, archivedCount: 0, skippedCount: 1 };
  }
}

/**
 * Applies all active, non-legal-hold retention policies for one organization.
 * Every policy run is recorded in RetentionRun and the audit log.
 */
export async function runRetentionPolicies(input: {
  organizationId: string;
  actorUserId?: string | null;
}) {
  const { organizationId } = input;
  const policies = await prisma.dataRetentionPolicy.findMany({
    where: { organizationId, isActive: true, legalHold: false },
  });
  const summary: Array<{ dataType: string; deleted: number; archived: number; skipped: number }> = [];

  for (const policy of policies) {
    const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
    const result = await applyPolicy(
      organizationId,
      policy.dataType as RetentionDataType,
      policy.action as RetentionAction,
      cutoff,
      input.actorUserId ?? null,
    );
    await prisma.retentionRun.create({
      data: {
        organizationId,
        dataType: policy.dataType,
        deletedCount: result.deletedCount,
        archivedCount: result.archivedCount,
        skippedCount: result.skippedCount,
        createdById: input.actorUserId ?? null,
      },
    });
    summary.push({
      dataType: policy.dataType,
      deleted: result.deletedCount,
      archived: result.archivedCount,
      skipped: result.skippedCount,
    });
  }

  if (summary.length > 0) {
    await recordAuditLog({
      organizationId,
      actorUserId: input.actorUserId ?? null,
      action: 'RETENTION_RUN',
      resource: 'RETENTION_POLICY',
      description: `Applied ${summary.length} retention policies.`,
      metadata: { summary } as Prisma.InputJsonValue,
    });
  }

  return summary;
}

export async function listRetentionRuns(organizationId: string, take = 50) {
  return prisma.retentionRun.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}
