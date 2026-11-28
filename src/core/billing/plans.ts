import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { ValidationError } from '@/core/errors';
import { MODULE_REGISTRY } from '@/core/modules/registry';
import { platformAudit } from './audit';

type Db = Prisma.TransactionClient | PrismaClient;

export interface PlanInput {
  name: string;
  slug: string;
  description?: string;
  currency: string;
  monthlyPrice: string | number;
  yearlyPrice: string | number;
  trialDays: number;
  allowedIntervals: string[];
  maxEmployees?: number | null;
  maxUsers?: number | null;
  maxProjects?: number | null;
  maxStorageMb?: number | null;
  maxApiCalls?: number | null;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  isRecommended: boolean;
  features?: Record<string, unknown>;
  customConfig?: Record<string, unknown>;
  modules: Array<{
    moduleKey: string;
    isIncluded: boolean;
    monthlyPrice: string | number;
    yearlyPrice: string | number;
  }>;
}

function decimal(value: string | number, field: string) {
  const parsed = new Prisma.Decimal(value.toString());
  if (parsed.isNegative()) throw new ValidationError(`${field} cannot be negative.`);
  return parsed;
}

function assertPlanInput(input: PlanInput) {
  if (!input.name.trim() || !input.slug.trim()) throw new ValidationError('Plan name and slug are required.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    throw new ValidationError('Plan slug must be lowercase letters, digits, and hyphens.');
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new ValidationError('Use a 3-letter ISO currency code.');
  if (!Number.isInteger(input.trialDays) || input.trialDays < 0 || input.trialDays > 365) {
    throw new ValidationError('Trial days must be between 0 and 365.');
  }
  const intervals = input.allowedIntervals.filter((value) => ['MONTHLY', 'YEARLY'].includes(value));
  if (intervals.length === 0) throw new ValidationError('At least one billing interval is required.');
  for (const planModule of input.modules) {
    if (!(planModule.moduleKey in MODULE_REGISTRY)) {
      throw new ValidationError(`Unknown module key: ${planModule.moduleKey}.`);
    }
  }
}

export async function listPlans(options?: { includeInactive?: boolean }, db: Db = prisma) {
  return db.subscriptionPlan.findMany({
    where: options?.includeInactive ? {} : { isActive: true, isPublic: true },
    include: { modules: { orderBy: { moduleKey: 'asc' } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getPlan(id: string, db: Db = prisma) {
  const plan = await db.subscriptionPlan.findUnique({
    where: { id },
    include: { modules: { orderBy: { moduleKey: 'asc' } } },
  });
  if (!plan) throw new ValidationError('Plan not found.');
  return plan;
}

export async function createPlan(input: {
  plan: PlanInput;
  actor: { id: string; email: string };
}) {
  assertPlanInput(input.plan);
  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.subscriptionPlan.create({
      data: {
        name: input.plan.name.trim(),
        slug: input.plan.slug.trim(),
        description: input.plan.description?.trim() || null,
        currency: input.plan.currency,
        monthlyPrice: decimal(input.plan.monthlyPrice, 'Monthly price'),
        yearlyPrice: decimal(input.plan.yearlyPrice, 'Yearly price'),
        trialDays: input.plan.trialDays,
        allowedIntervals: input.plan.allowedIntervals.join(','),
        maxEmployees: input.plan.maxEmployees ?? null,
        maxUsers: input.plan.maxUsers ?? null,
        maxProjects: input.plan.maxProjects ?? null,
        maxStorageMb: input.plan.maxStorageMb ?? null,
        maxApiCalls: input.plan.maxApiCalls ?? null,
        isActive: Boolean(input.plan.isActive),
        isPublic: Boolean(input.plan.isPublic),
        sortOrder: Math.trunc(input.plan.sortOrder),
        isRecommended: Boolean(input.plan.isRecommended),
        features: (input.plan.features ?? {}) as Prisma.InputJsonValue,
        customConfig: (input.plan.customConfig ?? {}) as Prisma.InputJsonValue,
        modules: {
          create: input.plan.modules.map((module) => ({
            moduleKey: module.moduleKey,
            isIncluded: Boolean(module.isIncluded),
            monthlyPrice: decimal(module.monthlyPrice, 'Module monthly price'),
            yearlyPrice: decimal(module.yearlyPrice, 'Module yearly price'),
          })),
        },
      },
    });
    await platformAudit({
      actor: input.actor,
      action: 'PLAN_CREATED',
      resource: 'SUBSCRIPTION_PLAN',
      resourceId: created.id,
      db: tx,
    });
    return created;
  });
  return plan;
}

export async function updatePlan(input: {
  id: string;
  plan: PlanInput;
  actor: { id: string; email: string };
}) {
  assertPlanInput(input.plan);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.subscriptionPlan.findUnique({ where: { id: input.id } });
    if (!existing) throw new ValidationError('Plan not found.');
    const updated = await tx.subscriptionPlan.update({
      where: { id: input.id },
      data: {
        name: input.plan.name.trim(),
        description: input.plan.description?.trim() || null,
        currency: input.plan.currency,
        monthlyPrice: decimal(input.plan.monthlyPrice, 'Monthly price'),
        yearlyPrice: decimal(input.plan.yearlyPrice, 'Yearly price'),
        trialDays: input.plan.trialDays,
        allowedIntervals: input.plan.allowedIntervals.join(','),
        maxEmployees: input.plan.maxEmployees ?? null,
        maxUsers: input.plan.maxUsers ?? null,
        maxProjects: input.plan.maxProjects ?? null,
        maxStorageMb: input.plan.maxStorageMb ?? null,
        maxApiCalls: input.plan.maxApiCalls ?? null,
        isActive: Boolean(input.plan.isActive),
        isPublic: Boolean(input.plan.isPublic),
        sortOrder: Math.trunc(input.plan.sortOrder),
        isRecommended: Boolean(input.plan.isRecommended),
        features: (input.plan.features ?? {}) as Prisma.InputJsonValue,
        customConfig: (input.plan.customConfig ?? {}) as Prisma.InputJsonValue,
      },
    });
    await tx.planModule.deleteMany({ where: { planId: updated.id } });
    await tx.planModule.createMany({
      data: input.plan.modules.map((module) => ({
        planId: updated.id,
        moduleKey: module.moduleKey,
        isIncluded: Boolean(module.isIncluded),
        monthlyPrice: decimal(module.monthlyPrice, 'Module monthly price'),
        yearlyPrice: decimal(module.yearlyPrice, 'Module yearly price'),
      })),
    });
    await platformAudit({
      actor: input.actor,
      action: 'PLAN_UPDATED',
      resource: 'SUBSCRIPTION_PLAN',
      resourceId: updated.id,
      db: tx,
    });
    return updated;
  });
}

export async function setPlanActive(input: {
  id: string;
  isActive: boolean;
  actor: { id: string; email: string };
}) {
  const plan = await prisma.subscriptionPlan.update({
    where: { id: input.id },
    data: { isActive: Boolean(input.isActive) },
  });
  await platformAudit({
    actor: input.actor,
    action: input.isActive ? 'PLAN_ACTIVATED' : 'PLAN_DEACTIVATED',
    resource: 'SUBSCRIPTION_PLAN',
    resourceId: plan.id,
  });
  return plan;
}

export async function purchaseModule(input: {
  organizationId: string;
  moduleKey: string;
  interval: 'MONTHLY' | 'YEARLY';
  actorUserId: string;
  actorEmail: string;
}) {
  if (!(input.moduleKey in MODULE_REGISTRY)) throw new ValidationError('Unknown module.');
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    if (!subscription) throw new ValidationError('No subscription found.');
    if (!['TRIALING', 'ACTIVE', 'GRACE_PERIOD'].includes(subscription.status)) {
      throw new ValidationError('Subscription is not entitled to purchase modules.');
    }
    const included = await tx.planModule.findFirst({
      where: { planId: subscription.planId, moduleKey: input.moduleKey },
    });
    if (included?.isIncluded) throw new ValidationError('This module is already included in your plan.');

    const price = await tx.planModule.findFirst({
      where: { planId: subscription.planId, moduleKey: input.moduleKey },
    });
    const amount = price
      ? input.interval === 'MONTHLY' ? price.monthlyPrice : price.yearlyPrice
      : new Prisma.Decimal(0);

    const record = await tx.subscriptionModule.upsert({
      where: {
        subscriptionId_moduleKey: { subscriptionId: subscription.id, moduleKey: input.moduleKey },
      },
      update: { status: 'ACTIVE', cancelledAt: null },
      create: {
        subscriptionId: subscription.id,
        moduleKey: input.moduleKey,
        status: 'ACTIVE',
        monthlyPrice: price?.monthlyPrice ?? new Prisma.Decimal(0),
        yearlyPrice: price?.yearlyPrice ?? new Prisma.Decimal(0),
      },
    });
    await tx.organizationModule.upsert({
      where: {
        organizationId_moduleKey: { organizationId: input.organizationId, moduleKey: input.moduleKey },
      },
      update: { isEnabled: true },
      create: { organizationId: input.organizationId, moduleKey: input.moduleKey, isEnabled: true },
    });
    await platformAudit(
      {
        actor: { id: input.actorUserId, email: input.actorEmail, name: input.actorEmail },
        action: 'MODULE_PURCHASED',
        resource: 'SUBSCRIPTION_MODULE',
        resourceId: record.id,
        metadata: { moduleKey: input.moduleKey, amount: amount.toString() },
        db: tx,
      });
    return record;
  });
}
