import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { ValidationError, ConflictError } from '@/core/errors';
import { billingAudit } from './audit';
import { currentUsagePeriod } from './usage';
import { inTransaction } from './transaction';

type Db = Prisma.TransactionClient | PrismaClient;

export const SUBSCRIPTION_STATUSES = [
  'TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED', 'EXPIRED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type BillingInterval = 'MONTHLY' | 'YEARLY';

/** Statuses that grant product access. Payment status is tracked separately. */
export const ENTITLED_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'GRACE_PERIOD'];

const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIALING: ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'SUSPENDED', 'GRACE_PERIOD'],
  ACTIVE: ['PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
  PAST_DUE: ['GRACE_PERIOD', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED'],
  GRACE_PERIOD: ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'GRACE_PERIOD', 'EXPIRED', 'CANCELLED'],
  CANCELLED: ['EXPIRED'],
  EXPIRED: [],
};

export function assertValidTransition(from: string, to: string) {
  const allowed = ALLOWED_TRANSITIONS[from as SubscriptionStatus];
  if (!allowed || !allowed.includes(to as SubscriptionStatus)) {
    throw new ValidationError(`Invalid subscription transition ${from} → ${to}.`);
  }
}

export function assertInterval(value: string): BillingInterval {
  if (value !== 'MONTHLY' && value !== 'YEARLY') {
    throw new ValidationError('Billing interval must be MONTHLY or YEARLY.');
  }
  return value;
}

export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
}

export function addYearsClamped(date: Date, years: number): Date {
  return addMonthsClamped(date, years * 12);
}

export function nextBillingDate(from: Date, interval: BillingInterval): Date {
  return interval === 'MONTHLY' ? addMonthsClamped(from, 1) : addYearsClamped(from, 1);
}

export async function getActiveSubscription(organizationId: string, db: Db = prisma) {
  return db.organizationSubscription.findUnique({
    where: { organizationId },
    include: { plan: true, modules: { where: { status: 'ACTIVE' } } },
  });
}

export async function recordHistory(input: {
  organizationId: string;
  subscriptionId?: string | null;
  planId?: string | null;
  planName: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  fromPlanName?: string | null;
  toPlanName?: string | null;
  effectiveAt?: Date | null;
  actorUserId?: string | null;
  actorEmail?: string;
  metadata?: Prisma.InputJsonValue;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return db.subscriptionHistory.create({
    data: {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId ?? null,
      planId: input.planId ?? null,
      planName: input.planName,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      fromPlanName: input.fromPlanName ?? null,
      toPlanName: input.toPlanName ?? null,
      effectiveAt: input.effectiveAt ?? null,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      metadata: input.metadata,
    },
  });
}

async function assertPlan(planId: string, db: Db) {
  const plan = await db.subscriptionPlan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan) throw new ValidationError('The selected plan is not available.');
  if (!(plan.allowedIntervals || 'MONTHLY,YEARLY').split(',').includes('MONTHLY')) {
    // Interval-specific validation is done by callers using plan.allowedIntervals.
  }
  return plan;
}

/**
 * Starts the one-and-only free trial for an organization. Trial abuse is
 * prevented by checking SubscriptionHistory for a previous TRIAL_STARTED.
 */
export async function startTrial(input: {
  organizationId: string;
  planId: string;
  actorUserId?: string;
  actorEmail?: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return inTransaction(db, async (tx) => {
    const existing = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (existing) throw new ConflictError('This organization already has a subscription.');

    const previousTrial = await tx.subscriptionHistory.count({
      where: { organizationId: input.organizationId, action: 'TRIAL_STARTED' },
    });
    if (previousTrial > 0) {
      throw new ValidationError('A free trial has already been used for this organization.');
    }

    const plan = await assertPlan(input.planId, tx);
    const now = new Date();
    const trialEnd = new Date(now.getTime() + Math.max(1, plan.trialDays) * 24 * 60 * 60 * 1000);
    const subscription = await tx.organizationSubscription.create({
      data: {
        organizationId: input.organizationId,
        planId: plan.id,
        status: 'TRIALING',
        billingInterval: 'MONTHLY',
        trialStart: now,
        trialEnd,
        startDate: now,
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
        nextBillingDate: trialEnd,
        paymentStatus: 'NONE',
      },
    });
    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: plan.id,
      planName: plan.name,
      action: 'TRIAL_STARTED',
      toStatus: 'TRIALING',
      effectiveAt: now,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      metadata: { trialEnd: trialEnd.toISOString() },
      db: tx,
    });
    await billingAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      action: 'TRIAL_STARTED',
      resource: 'SUBSCRIPTION',
      resourceId: subscription.id,
      db: tx,
    });
    return subscription;
  });
}

export async function extendTrial(input: {
  organizationId: string;
  days: number;
  actor: { id: string; email: string };
  db?: Db;
}) {
  const db = input.db ?? prisma;
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) {
    throw new ValidationError('Trial extension must be between 1 and 365 days.');
  }
  return inTransaction(db, async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    if (!subscription) throw new ValidationError('Organization has no subscription.');
    if (subscription.status !== 'TRIALING') throw new ValidationError('Only a trialing subscription can be extended.');
    const newEnd = new Date(
      Math.max(Date.now(), subscription.trialEnd?.getTime() ?? Date.now()) + input.days * 24 * 60 * 60 * 1000,
    );
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: { trialEnd: newEnd, currentPeriodEnd: newEnd, nextBillingDate: newEnd },
    });
    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planName: subscription.plan.name,
      action: 'TRIAL_EXTENDED',
      fromStatus: subscription.status,
      toStatus: subscription.status,
      effectiveAt: newEnd,
      actorUserId: input.actor.id,
      actorEmail: input.actor.email,
      metadata: { days: input.days, newTrialEnd: newEnd.toISOString() },
      db: tx,
    });
    return updated;
  });
}

/**
 * Activates or renews a paid subscription. Callers must pass authoritative
 * proof of payment (or explicit platform approval) via paymentStatus.
 */
export async function activatePaidSubscription(input: {
  organizationId: string;
  planId: string;
  interval: string;
  paymentStatus: string;
  actorUserId?: string;
  actorEmail?: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  const interval = assertInterval(input.interval);
  if (input.paymentStatus !== 'PAID' && input.paymentStatus !== 'MANUAL_APPROVED') {
    throw new ValidationError('Payment must be verified before activating a paid subscription.');
  }
  return inTransaction(db, async (tx) => {
    const plan = await assertPlan(input.planId, tx);
    if (!(plan.allowedIntervals || 'MONTHLY,YEARLY').split(',').includes(interval)) {
      throw new ValidationError(`This plan does not support ${interval} billing.`);
    }
    const existing = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    const now = new Date();
    const periodEnd = nextBillingDate(now, interval);
    const fromStatus = existing?.status ?? 'NONE';
    if (existing && existing.status !== 'CANCELLED' && existing.status !== 'EXPIRED') {
      assertValidTransition(existing.status, 'ACTIVE');
    }

    const subscription = existing
      ? await tx.organizationSubscription.update({
          where: { id: existing.id },
          data: {
            planId: plan.id,
            status: 'ACTIVE',
            billingInterval: interval,
            startDate: existing.startDate ?? now,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            gracePeriodEnd: null,
            cancelledAt: null,
            cancellationReason: null,
            paymentStatus: input.paymentStatus,
            failedPaymentCount: 0,
            lastPaymentFailedAt: null,
          },
        })
      : await tx.organizationSubscription.create({
          data: {
            organizationId: input.organizationId,
            planId: plan.id,
            status: 'ACTIVE',
            billingInterval: interval,
            startDate: now,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            paymentStatus: input.paymentStatus,
          },
        });

    // Optional modules are activated only when the caller purchased them.
    const included = await tx.planModule.findMany({ where: { planId: plan.id, isIncluded: true } });
    for (const includedModule of included) {
      await tx.subscriptionModule.upsert({
        where: {
          subscriptionId_moduleKey: { subscriptionId: subscription.id, moduleKey: includedModule.moduleKey },
        },
        update: { status: 'ACTIVE', expiresAt: periodEnd },
        create: {
          subscriptionId: subscription.id,
          moduleKey: includedModule.moduleKey,
          status: 'ACTIVE',
          monthlyPrice: includedModule.monthlyPrice,
          yearlyPrice: includedModule.yearlyPrice,
          expiresAt: periodEnd,
        },
      });
    }

    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: plan.id,
      planName: plan.name,
      action: existing ? 'SUBSCRIPTION_ACTIVATED' : 'SUBSCRIPTION_CREATED',
      fromStatus,
      toStatus: 'ACTIVE',
      fromPlanName: existing?.plan?.name,
      toPlanName: plan.name,
      effectiveAt: now,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      metadata: { interval, paymentStatus: input.paymentStatus },
      db: tx,
    });
    await billingAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      action: 'SUBSCRIPTION_ACTIVATED',
      resource: 'SUBSCRIPTION',
      resourceId: subscription.id,
      db: tx,
    });
    return subscription;
  });
}

export async function markPaymentFailed(input: {
  organizationId: string;
  failureReason: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return inTransaction(db, async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    if (!subscription) return null;
    if (!['ACTIVE', 'TRIALING', 'GRACE_PERIOD'].includes(subscription.status)) return subscription;
    const failedCount = subscription.failedPaymentCount + 1;
    const graceDays = Number(process.env.BILLING_GRACE_DAYS ?? 7);
    const status = failedCount >= 1 ? 'GRACE_PERIOD' : 'PAST_DUE';
    assertValidTransition(subscription.status, status);
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: {
        status,
        paymentStatus: 'FAILED',
        failedPaymentCount: failedCount,
        lastPaymentFailedAt: new Date(),
        gracePeriodEnd: new Date(Date.now() + Math.max(1, graceDays) * 24 * 60 * 60 * 1000),
      },
    });
    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planName: subscription.plan.name,
      action: 'PAYMENT_FAILED',
      fromStatus: subscription.status,
      toStatus: status,
      metadata: { failureReason: input.failureReason.slice(0, 300), failedCount },
      db: tx,
    });
    return updated;
  });
}

export async function recoverAfterPayment(input: {
  organizationId: string;
  actorUserId?: string;
  actorEmail?: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return inTransaction(db, async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    if (!subscription) throw new ValidationError('Subscription not found.');
    if (!['PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED'].includes(subscription.status)) return subscription;
    assertValidTransition(subscription.status, 'ACTIVE');
    const now = new Date();
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        failedPaymentCount: 0,
        gracePeriodEnd: null,
        currentPeriodStart: now,
        currentPeriodEnd: subscription.billingInterval === 'MONTHLY' ? addMonthsClamped(now, 1) : addYearsClamped(now, 1),
        nextBillingDate: subscription.billingInterval === 'MONTHLY' ? addMonthsClamped(now, 1) : addYearsClamped(now, 1),
      },
    });
    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planName: subscription.plan.name,
      action: 'PAYMENT_RECOVERED',
      fromStatus: subscription.status,
      toStatus: 'ACTIVE',
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      db: tx,
    });
    return updated;
  });
}

export async function changePlan(input: {
  organizationId: string;
  targetPlanId: string;
  interval?: string;
  actorUserId: string;
  actorEmail: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return inTransaction(db, async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    if (!subscription) throw new ValidationError('Subscription not found.');
    if (!ENTITLED_STATUSES.includes(subscription.status as SubscriptionStatus)) {
      throw new ValidationError('Only an active or trialing subscription can change plans.');
    }
    const target = await assertPlan(input.targetPlanId, tx);
    if (target.id === subscription.planId) throw new ValidationError('Already on this plan.');
    const interval = assertInterval(input.interval ?? subscription.billingInterval);

    const price = (value: Prisma.Decimal) => Number(value);
    const targetPrice = price(interval === 'MONTHLY' ? target.monthlyPrice : target.yearlyPrice);
    const currentPrice = price(interval === 'MONTHLY' ? subscription.plan.monthlyPrice : subscription.plan.yearlyPrice);
    const isUpgrade = targetPrice > currentPrice;

    if (!isUpgrade) {
      // Downgrade: check usage and modules before scheduling. Never delete data.
      const { checkUsageLimit } = await import('./usage');
      const limits: Array<[string, number]> = [
        ['EMPLOYEES', target.maxEmployees ?? Number.MAX_SAFE_INTEGER],
        ['USERS', target.maxUsers ?? Number.MAX_SAFE_INTEGER],
        ['PROJECTS', target.maxProjects ?? Number.MAX_SAFE_INTEGER],
        ['STORAGE_MB', target.maxStorageMb ?? Number.MAX_SAFE_INTEGER],
        ['API_CALLS', target.maxApiCalls ?? Number.MAX_SAFE_INTEGER],
      ];
      for (const [category] of limits) {
        const check = await checkUsageLimit(input.organizationId, category, 0);
        if (check.limit !== null && targetLimitFor(category, target) !== null && check.used > (targetLimitFor(category, target) as number)) {
          throw new ValidationError(
            `Downgrade is blocked: ${check.used} ${category.toLowerCase().replace('_', ' ')} exceed the ${target.name} plan limit of ${targetLimitFor(category, target)}.`,
          );
        }
      }
      const includedModules = await tx.planModule.findMany({
        where: { planId: target.id, isIncluded: true },
        select: { moduleKey: true },
      });
      const includedKeys = new Set(includedModules.map((module) => module.moduleKey));
      const activeModules = await tx.organizationModule.findMany({
        where: { organizationId: input.organizationId, isEnabled: true },
        select: { moduleKey: true },
      });
      const unsupported = activeModules
        .map((module) => module.moduleKey)
        .filter((key) => !includedKeys.has(key));
      const purchased = await tx.subscriptionModule.findMany({
        where: { subscriptionId: subscription.id, status: 'ACTIVE' },
        select: { moduleKey: true },
      });
      const purchasedKeys = new Set(purchased.map((module) => module.moduleKey));
      const conflicts = unsupported.filter((key) => !purchasedKeys.has(key));
      if (conflicts.length > 0) {
        throw new ValidationError(
          `Downgrade is blocked: these modules are not included in ${target.name}: ${conflicts.join(', ')}. Disable or purchase them first.`,
        );
      }

      await tx.scheduledPlanChange.create({
        data: {
          organizationId: input.organizationId,
          subscriptionId: subscription.id,
          targetPlanId: target.id,
          targetInterval: interval,
          action: 'DOWNGRADE',
          effectiveAt: subscription.currentPeriodEnd ?? subscription.nextBillingDate ?? new Date(),
          status: 'SCHEDULED',
          metadata: { fromPlan: subscription.plan.name, toPlan: target.name } as Prisma.InputJsonValue,
        },
      });
      await recordHistory({
        organizationId: input.organizationId,
        subscriptionId: subscription.id,
        planId: target.id,
        planName: subscription.plan.name,
        action: 'DOWNGRADE_SCHEDULED',
        fromStatus: subscription.status,
        toStatus: subscription.status,
        fromPlanName: subscription.plan.name,
        toPlanName: target.name,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        db: tx,
      });
      return { mode: 'SCHEDULED' as const, subscription, target };
    }

    // Upgrade uses the same verification-gated activation path.
    await tx.scheduledPlanChange.create({
      data: {
        organizationId: input.organizationId,
        subscriptionId: subscription.id,
        targetPlanId: target.id,
        targetInterval: interval,
        action: 'UPGRADE',
        effectiveAt: new Date(),
        status: 'AWAITING_PAYMENT',
        metadata: { fromPlan: subscription.plan.name, toPlan: target.name, amount: targetPrice } as Prisma.InputJsonValue,
      },
    });
    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: target.id,
      planName: subscription.plan.name,
      action: 'UPGRADE_REQUESTED',
      fromStatus: subscription.status,
      toStatus: subscription.status,
      fromPlanName: subscription.plan.name,
      toPlanName: target.name,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      db: tx,
    });
    return { mode: 'PAYMENT_REQUIRED' as const, subscription, target, amount: targetPrice };
  });
}

function targetLimitFor(category: string, plan: { maxEmployees: number | null; maxUsers: number | null; maxProjects: number | null; maxStorageMb: number | null; maxApiCalls: number | null }): number | null {
  switch (category) {
    case 'EMPLOYEES': return plan.maxEmployees;
    case 'USERS': return plan.maxUsers;
    case 'PROJECTS': return plan.maxProjects;
    case 'STORAGE_MB': return plan.maxStorageMb;
    case 'API_CALLS': return plan.maxApiCalls;
    default: return null;
  }
}

export async function cancelSubscription(input: {
  organizationId: string;
  reason: string;
  actorUserId?: string;
  actorEmail?: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return inTransaction(db, async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    if (!subscription) throw new ValidationError('Subscription not found.');
    if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
      throw new ValidationError('Subscription is already cancelled or expired.');
    }
    assertValidTransition(subscription.status, 'CANCELLED');
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELLED', autoRenew: false, cancelledAt: new Date(), cancellationReason: input.reason.slice(0, 500) },
    });
    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planName: subscription.plan.name,
      action: 'SUBSCRIPTION_CANCELLED',
      fromStatus: subscription.status,
      toStatus: 'CANCELLED',
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      metadata: { reason: input.reason },
      db: tx,
    });
    return updated;
  });
}

export async function suspendOrExpire(input: {
  organizationId: string;
  status: 'SUSPENDED' | 'EXPIRED';
  actor?: { id: string; email: string };
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return inTransaction(db, async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    if (!subscription) return null;
    assertValidTransition(subscription.status, input.status);
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: { status: input.status },
    });
    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planName: subscription.plan.name,
      action: input.status === 'SUSPENDED' ? 'SUBSCRIPTION_SUSPENDED' : 'SUBSCRIPTION_EXPIRED',
      fromStatus: subscription.status,
      toStatus: input.status,
      actorUserId: input.actor?.id ?? null,
      actorEmail: input.actor?.email,
      db: tx,
    });
    return updated;
  });
}

export async function reactivateSubscription(input: {
  organizationId: string;
  actor: { id: string; email: string };
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return inTransaction(db, async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      include: { plan: true },
    });
    if (!subscription) throw new ValidationError('Subscription not found.');
    if (!['SUSPENDED', 'GRACE_PERIOD', 'PAST_DUE'].includes(subscription.status)) {
      throw new ValidationError('Only suspended, past-due, or grace-period subscriptions can be reactivated.');
    }
    assertValidTransition(subscription.status, 'ACTIVE');
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: { status: 'ACTIVE', paymentStatus: 'MANUAL_APPROVED', gracePeriodEnd: null, failedPaymentCount: 0 },
    });
    await recordHistory({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planName: subscription.plan.name,
      action: 'SUBSCRIPTION_REACTIVATED',
      fromStatus: subscription.status,
      toStatus: 'ACTIVE',
      actorUserId: input.actor.id,
      actorEmail: input.actor.email,
      db: tx,
    });
    return updated;
  });
}

export async function setAutoRenew(input: {
  organizationId: string;
  autoRenew: boolean;
  actorUserId: string;
  actorEmail: string;
}) {
  const subscription = await prisma.organizationSubscription.update({
    where: { organizationId: input.organizationId },
    data: { autoRenew: Boolean(input.autoRenew) },
  });
  await billingAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: input.autoRenew ? 'AUTO_RENEW_ENABLED' : 'AUTO_RENEW_DISABLED',
    resource: 'SUBSCRIPTION',
    resourceId: subscription.id,
  });
  return subscription;
}

/** Idempotent renewal: refuses to run twice for the same period end. */
export async function renewSubscription(subscriptionId: string, db: Db = prisma) {
  return inTransaction(db, async (tx) => {
    const subscription = await tx.organizationSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw new ValidationError('Subscription not found.');
    if (subscription.status !== 'ACTIVE' || !subscription.autoRenew) return null;
    const anchor = subscription.nextBillingDate ?? subscription.currentPeriodEnd ?? new Date();
    if (anchor.getTime() > Date.now()) return null;
    const next = nextBillingDate(anchor, subscription.billingInterval as BillingInterval);
    const updated = await tx.organizationSubscription.update({
      where: { id: subscription.id },
      data: { currentPeriodStart: anchor, currentPeriodEnd: next, nextBillingDate: next, paymentStatus: 'PENDING' },
    });
    await recordHistory({
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planName: subscription.plan.name,
      action: 'SUBSCRIPTION_RENEWED',
      fromStatus: subscription.status,
      toStatus: subscription.status,
      effectiveAt: next,
      metadata: { previousPeriodEnd: anchor.toISOString(), nextPeriodEnd: next.toISOString() },
      db: tx,
    });
    return updated;
  });
}

/** Applies due downgrades at the billing boundary without deleting data. */
export async function applyScheduledChanges(db: Db = prisma) {
  const due = await db.scheduledPlanChange.findMany({
    where: { status: 'SCHEDULED', effectiveAt: { lte: new Date() } },
    take: 100,
  });
  let applied = 0;
  for (const change of due) {
    const claimed = await db.scheduledPlanChange.updateMany({
      where: { id: change.id, status: 'SCHEDULED' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1) continue;
    try {
      await inTransaction(db, async (tx) => {
        const subscription = await tx.organizationSubscription.findUnique({
          where: { id: change.subscriptionId },
          include: { plan: true },
        });
        const plan = await tx.subscriptionPlan.findUnique({ where: { id: change.targetPlanId } });
        if (!subscription || !plan) throw new ValidationError('Scheduled change target no longer exists.');
        if (ENTITLED_STATUSES.includes(subscription.status as SubscriptionStatus)) {
          await tx.organizationSubscription.update({
            where: { id: subscription.id },
            data: { planId: plan.id, billingInterval: change.targetInterval ?? subscription.billingInterval },
          });
          await recordHistory({
            organizationId: change.organizationId,
            subscriptionId: subscription.id,
            planId: plan.id,
            planName: subscription.plan.name,
            action: 'DOWNGRADE_APPLIED',
            fromPlanName: subscription.plan.name,
            toPlanName: plan.name,
            fromStatus: subscription.status,
            toStatus: subscription.status,
            effectiveAt: new Date(),
            db: tx,
          });
        }
        await tx.scheduledPlanChange.update({
          where: { id: change.id },
          data: { status: 'APPLIED', processedAt: new Date() },
        });
      });
      applied += 1;
    } catch (error) {
      await db.scheduledPlanChange.update({
        where: { id: change.id },
        data: { status: 'SKIPPED', skippedReason: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error' },
      });
    }
  }
  return { applied, skipped: due.length - applied };
}

export async function expireTrials(db: Db = prisma) {
  const expired = await db.organizationSubscription.findMany({
    where: { status: 'TRIALING', trialEnd: { lte: new Date() } },
    select: { id: true, organizationId: true },
    take: 200,
  });
  let count = 0;
  for (const item of expired) {
    const result = await suspendOrExpire({
      organizationId: item.organizationId,
      status: 'EXPIRED',
      db,
    }).catch(() => null);
    if (result) count += 1;
  }
  return { expired: count };
}

export async function expireGracePeriods(db: Db = prisma) {
  const due = await db.organizationSubscription.findMany({
    where: { status: 'GRACE_PERIOD', gracePeriodEnd: { lte: new Date() } },
    select: { organizationId: true },
    take: 200,
  });
  let suspended = 0;
  for (const item of due) {
    const result = await suspendOrExpire({ organizationId: item.organizationId, status: 'SUSPENDED', db }).catch(() => null);
    if (result) suspended += 1;
  }
  return { suspended };
}

export { currentUsagePeriod };
