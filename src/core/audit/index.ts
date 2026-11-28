import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/core/db/prisma';

type DbClient = Prisma.TransactionClient | PrismaClient;

const SENSITIVE_KEY_PATTERN =
  /pass(word|hash)?|secret|token|authorization|cookie|api[-_]?key|credential|otp|pin/i;

/**
 * Recursively removes authentication secrets and other sensitive values from
 * audit payloads. Audit records must never contain passwords, hashes, tokens,
 * or session secrets.
 */
export function sanitizeAuditPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => sanitizeAuditPayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? '[redacted]'
        : sanitizeAuditPayload(item, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string' && value.length > 4000) {
    return `${value.slice(0, 4000)}…`;
  }
  return value;
}

export interface AuditLogInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string | null;
  resource?: string;
  resourceId?: string | null;
  action: string;
  description?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface RequestAuditContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Extracts request metadata from the current Next.js request when available.
 * Safe to call outside a request scope (tests, cron jobs) — returns {}.
 */
export async function getRequestAuditContext(): Promise<RequestAuditContext> {
  try {
    const { headers } = await import('next/headers');
    const headerList = headers();
    const forwardedFor = headerList.get('x-forwarded-for');
    return {
      ipAddress: forwardedFor?.split(',')[0]?.trim() || headerList.get('x-real-ip') || undefined,
      userAgent: headerList.get('user-agent') || undefined,
      requestId:
        headerList.get('x-request-id') ||
        headerList.get('x-correlation-id') ||
        undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Centralized audit log recorder writing to AuditLog.
 * Runs inside the caller's transaction when tx is provided.
 */
export async function recordAuditLog(
  input: AuditLogInput,
  db: DbClient = prisma,
) {
  const context = await getRequestAuditContext();
  const resource = input.resource ?? input.targetType ?? 'UNKNOWN';
  const resourceId = input.resourceId ?? input.targetId ?? null;

  return db.auditLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      userId: input.actorUserId ?? null,
      action: input.action,
      resource,
      resourceId,
      description: input.description,
      oldValues: input.before
        ? (sanitizeAuditPayload(input.before) as Prisma.InputJsonValue)
        : undefined,
      newValues: input.after
        ? (sanitizeAuditPayload(input.after) as Prisma.InputJsonValue)
        : undefined,
      metadata: input.metadata
        ? (sanitizeAuditPayload(input.metadata) as Prisma.InputJsonValue)
        : undefined,
      ipAddress: input.ipAddress ?? context.ipAddress ?? null,
      userAgent: input.userAgent ?? context.userAgent ?? null,
      requestId: input.requestId ?? context.requestId ?? null,
    },
  });
}

export interface AuditSearchInput {
  organizationId: string;
  page?: number;
  pageSize?: number;
  resource?: string;
  action?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  search?: string;
}

export async function searchAuditLogs(input: AuditSearchInput) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize ?? 25));
  const where: Prisma.AuditLogWhereInput = {
    organizationId: input.organizationId,
    ...(input.resource ? { resource: input.resource } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.from || input.to
      ? {
          createdAt: {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        }
      : {}),
    ...(input.search
      ? {
          OR: [
            { description: { contains: input.search, mode: 'insensitive' } },
            { resource: { contains: input.search, mode: 'insensitive' } },
            { action: { contains: input.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
