import { prisma } from '@/core/db/prisma';
import { ValidationError } from '@/core/errors';

export const USAGE_CATEGORIES = [
  'EMPLOYEES',
  'USERS',
  'PROJECTS',
  'STORAGE_MB',
  'API_CALLS',
  'INVOICES',
  'WAREHOUSES',
] as const;
export type UsageCategory = (typeof USAGE_CATEGORIES)[number];

const LIMIT_FIELD: Record<UsageCategory, string> = {
  EMPLOYEES: 'maxEmployees',
  USERS: 'maxUsers',
  PROJECTS: 'maxProjects',
  STORAGE_MB: 'maxStorageMb',
  API_CALLS: 'maxApiCalls',
  INVOICES: 'invoices',
  WAREHOUSES: 'warehouses',
};

export interface UsagePeriod {
  start: Date;
  end: Date;
}

export function currentUsagePeriod(now = new Date()): UsagePeriod {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59)),
  };
}

function assertCategory(category: string): UsageCategory {
  if (!USAGE_CATEGORIES.includes(category as UsageCategory)) {
    throw new ValidationError('Unsupported usage category.');
  }
  return category as UsageCategory;
}

/** Atomically adds usage. Concurrent callers cannot lose an increment. */
export async function incrementUsage(input: {
  organizationId: string;
  category: string;
  amount?: number;
  resourceId?: string | null;
  period?: UsagePeriod;
}) {
  const category = assertCategory(input.category);
  const amount = Math.max(0, Math.trunc(input.amount ?? 1));
  const period = input.period ?? currentUsagePeriod();
  const key = input.resourceId ?? null;
  await prisma.$executeRaw`
    INSERT INTO "UsageRecord"
      ("id", "organizationId", "category", "quantity", "periodStart", "periodEnd", "resourceId", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid()::text, ${input.organizationId}, ${category}, ${amount}, ${period.start.toISOString().slice(0, 19)}::timestamp, ${period.end.toISOString().slice(0, 19)}::timestamp, ${key}, NOW(), NOW())
    ON CONFLICT ("organizationId", "category", "periodStart", "resourceId")
    DO UPDATE SET "quantity" = "UsageRecord"."quantity" + ${amount}, "updatedAt" = NOW()
  `;
}

export async function decrementUsage(input: {
  organizationId: string;
  category: string;
  amount?: number;
  resourceId?: string | null;
  period?: UsagePeriod;
}) {
  const category = assertCategory(input.category);
  const amount = Math.max(0, Math.trunc(input.amount ?? 1));
  const period = input.period ?? currentUsagePeriod();
  const key = input.resourceId ?? null;
  await prisma.$executeRaw`
    UPDATE "UsageRecord"
    SET "quantity" = GREATEST(0, "quantity" - ${amount}), "updatedAt" = NOW()
    WHERE "organizationId" = ${input.organizationId}
      AND "category" = ${category}
      AND "periodStart" = ${period.start.toISOString().slice(0, 19)}::timestamp
      AND "resourceId" IS NOT DISTINCT FROM ${key}
  `;
}

/**
 * Metered counters for API calls/exports/etc. Stored usage is combined with
 * actual record counts so a frontend counter can never be trusted.
 */
export async function getOrganizationUsage(
  organizationId: string,
  now = new Date(),
): Promise<Record<UsageCategory, number>> {
  const period = currentUsagePeriod(now);
  const [employees, users, projects, invoices, warehouses, tracked] = await Promise.all([
    prisma.employee.count({ where: { organizationId, archivedAt: null } }),
    prisma.user.count({ where: { organizationId, isActive: true } }),
    prisma.project.count({ where: { organizationId } }),
    prisma.invoice.count({ where: { organizationId } }),
    prisma.warehouse.count({ where: { organizationId } }),
    prisma.usageRecord.findMany({
      where: { organizationId, periodStart: period.start },
      select: { category: true, quantity: true },
    }),
  ]);

  const trackedByCategory = new Map<string, number>();
  for (const row of tracked) {
    trackedByCategory.set(row.category, (trackedByCategory.get(row.category) ?? 0) + row.quantity);
  }

  return {
    EMPLOYEES: employees,
    USERS: users,
    PROJECTS: projects,
    INVOICES: invoices,
    WAREHOUSES: warehouses,
    STORAGE_MB: trackedByCategory.get('STORAGE_MB') ?? 0,
    API_CALLS: trackedByCategory.get('API_CALLS') ?? 0,
  };
}

export async function limitForCategory(organizationId: string, category: string): Promise<number | null> {
  const normalized = assertCategory(category);
  const subscription = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (!subscription) return null;
  const value = (subscription.plan as unknown as Record<string, unknown>)[LIMIT_FIELD[normalized]];
  return typeof value === 'number' ? value : null;
}

export interface UsageCheck {
  allowed: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
  category: UsageCategory;
}

export async function checkUsageLimit(
  organizationId: string,
  category: string,
  additional = 1,
): Promise<UsageCheck> {
  const normalized = assertCategory(category);
  const [usage, limit] = await Promise.all([
    getOrganizationUsage(organizationId),
    limitForCategory(organizationId, category),
  ]);
  const used = usage[normalized];
  const remaining = limit === null ? null : Math.max(0, limit - used);
  return {
    allowed: limit === null || used + Math.max(0, additional) <= limit,
    used,
    limit,
    remaining,
    category: normalized,
  };
}

export async function assertUsageLimit(
  organizationId: string,
  category: string,
  additional = 1,
): Promise<UsageCheck> {
  const check = await checkUsageLimit(organizationId, category, additional);
  if (!check.allowed) {
    throw new ValidationError(
      `Your plan allows ${check.limit} ${check.category.toLowerCase().replace('_', ' ')}; ${check.used} are already in use.`,
    );
  }
  return check;
}
