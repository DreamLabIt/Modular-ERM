import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/core/db/prisma';

type DbClient = Prisma.TransactionClient | PrismaClient;

export interface AuditLogInput {
  organizationId: string;
  actorUserId: string;
  targetType: string;
  targetId: string;
  action: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Centralized audit log recorder writing to SecurityAuditLog.
 * Runs inside the caller's transaction when tx is provided.
 */
export async function recordAuditLog(
  input: AuditLogInput,
  db: DbClient = prisma,
) {
  return db.securityAuditLog.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      before: input.before,
      after: input.after,
    },
  });
}
