import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/core/db/prisma';

type Db = Prisma.TransactionClient | PrismaClient;

function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
}

/**
 * MRR is normalised monthly recurring revenue from active subscriptions only.
 * Yearly plans are divided by 12. One-time payments and manually approved
 * payments are never counted as MRR/ARR.
 */
export async function getPlatformAnalytics(db: Db = prisma) {
  const [organizations, subscriptions, invoices, payments, plans, trialCount, mrrRows] = await Promise.all([
    db.organization.count(),
    db.organizationSubscription.findMany({ include: { plan: true } }),
    db.billingInvoice.findMany({ select: { status: true, totalAmount: true, amountPaid: true } }),
    db.payment.findMany({ select: { status: true, amount: true, paidAt: true } }),
    db.subscriptionPlan.findMany({ include: { _count: { select: { subscriptions: true } } } }),
    db.organizationSubscription.count({ where: { status: 'TRIALING' } }),
    db.organizationSubscription.findMany({
      where: { status: { in: ['ACTIVE', 'GRACE_PERIOD'] } },
      include: { plan: true },
    }),
  ]);

  const mrr = sum(
    mrrRows.map((subscription) => {
      const price = subscription.billingInterval === 'YEARLY' ? subscription.plan.yearlyPrice : subscription.plan.monthlyPrice;
      return price;
    }),
  ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const collected = sum(payments.filter((payment) => payment.status === 'PAID').map((payment) => payment.amount));
  const outstanding = sum(
    invoices
      .filter((invoice) => ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status))
      .map((invoice) => new Prisma.Decimal(invoice.totalAmount).minus(invoice.amountPaid)),
  );

  const activeSubscriptions = subscriptions.filter((s) => s.status === 'ACTIVE').length;
  const pastDue = subscriptions.filter((s) => s.status === 'PAST_DUE' || s.status === 'GRACE_PERIOD').length;
  const expired = subscriptions.filter((s) => s.status === 'EXPIRED').length;
  const cancelled = subscriptions.filter((s) => s.status === 'CANCELLED').length;
  const converted = subscriptions.filter((s) => s.status !== 'TRIALING').length;
  const conversionRate = subscriptions.length === 0 ? 0 : Math.round((converted / subscriptions.length) * 100);

  return {
    organizations,
    activeSubscriptions,
    trialOrganizations: trialCount,
    expiredSubscriptions: expired,
    cancelledSubscriptions: cancelled,
    pastDueSubscriptions: pastDue,
    mrr: mrr.toString(),
    arr: mrr.mul(12).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString(),
    totalCollected: collected.toString(),
    outstandingInvoices: outstanding.toString(),
    failedPayments: payments.filter((payment) => payment.status === 'FAILED').length,
    upcomingRenewals: subscriptions.filter(
      (s) => s.autoRenew && s.nextBillingDate && s.nextBillingDate.getTime() < Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).length,
    trialConversionRate: conversionRate,
    planCounts: plans.map((plan) => ({ name: plan.name, subscriptions: plan._count.subscriptions })),
  };
}

export async function getPlatformSetting<T>(key: string, fallback: T, db: Db = prisma): Promise<T> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  return row ? (row.value as unknown as T) : fallback;
}

export async function setPlatformSetting(key: string, value: unknown, db: Db = prisma) {
  return db.platformSetting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, value: value as Prisma.InputJsonValue },
  });
}

export interface BillingSettings {
  graceDays: number;
  retryDays: number[];
  invoiceDueDays: number;
  prorationPolicy: string;
  refundPolicy: string;
  trialPrevention: boolean;
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  graceDays: 7,
  retryDays: [1, 3, 7],
  invoiceDueDays: 14,
  prorationPolicy: 'NO_PRORATION_UPGRADE_AT_FULL_PERIOD_PRICE',
  refundPolicy: 'NO_AUTOMATIC_REFUNDS_CREDIT_ADJUSTMENT_ONLY',
  trialPrevention: true,
};

export async function getBillingSettings(db: Db = prisma): Promise<BillingSettings> {
  const stored = await getPlatformSetting<Partial<BillingSettings>>('billing_settings', {}, db);
  return { ...DEFAULT_BILLING_SETTINGS, ...stored };
}

export async function saveBillingSettings(value: Partial<BillingSettings>, db: Db = prisma) {
  const merged = { ...DEFAULT_BILLING_SETTINGS, ...value };
  if (!Number.isInteger(merged.graceDays) || merged.graceDays < 0 || merged.graceDays > 90) {
    throw new Error('Grace days must be between 0 and 90.');
  }
  if (!Number.isInteger(merged.invoiceDueDays) || merged.invoiceDueDays < 1 || merged.invoiceDueDays > 90) {
    throw new Error('Invoice due days must be between 1 and 90.');
  }
  return setPlatformSetting('billing_settings', merged, db);
}
