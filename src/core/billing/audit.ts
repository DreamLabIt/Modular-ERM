import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { getRequestAuditContext, sanitizeAuditPayload } from '@/core/audit';
import { recordAuditLog } from '@/core/audit';

/**
 * Platform-level actions have no tenant, so they are recorded with the shared
 * AuditLog using a null organization and the platform admin's email in
 * metadata. No secrets or payment credentials are ever included.
 */
export async function platformAudit(input: {
  actor: { id: string; email: string; name?: string };
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  db?: Prisma.TransactionClient;
}) {
  const db = input.db ?? prisma;
  const context = await getRequestAuditContext();
  return db.auditLog.create({
    data: {
      organizationId: null,
      userId: null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      description: `${input.actor.email}: ${input.action}`,
      metadata: sanitizeAuditPayload({
        platformAdminId: input.actor.id,
        platformAdminEmail: input.actor.email,
        ...input.metadata,
      }) as Prisma.InputJsonValue,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    },
  });
}

/** Tenant billing actions are attributed to an organization user where possible. */
export async function billingAudit(input: {
  organizationId: string;
  actorUserId?: string | null;
  actorEmail?: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  db?: Prisma.TransactionClient;
}) {
  const db = input.db ?? prisma;
  return recordAuditLog(
    {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      description: `${input.actorEmail ?? 'System'}: ${input.action}`,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
    db,
  );
}
