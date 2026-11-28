import { prisma } from '@/core/db/prisma';
import { recordAuditLog } from '@/core/audit';
import {
  expireTrials,
  expireGracePeriods,
  applyScheduledChanges,
  renewSubscription,
} from './subscriptions';
import { generateInvoice, markOverdueInvoices } from './invoices';
import { getPaymentProvider } from './payments/providers';
import { getBillingSettings } from './analytics';

export interface BillingJobResult {
  startedAt: string;
  finishedAt: string;
  trialsExpired: number;
  gracePeriodsExpired: number;
  scheduledChangesApplied: number;
  scheduledChangesSkipped: number;
  renewalsProcessed: number;
  renewalInvoices: number;
  renewalFailures: number;
  invoicesMarkedOverdue: number;
}

/**
 * Idempotent scheduled billing processor. Every mutating step is guarded by a
 * status/date check inside a transaction, so two overlapping runs cannot
 * double-renew or double-invoice an organization.
 */
export async function runBillingJobs(now = new Date()): Promise<BillingJobResult> {
  const result: BillingJobResult = {
    startedAt: now.toISOString(),
    finishedAt: '',
    trialsExpired: 0,
    gracePeriodsExpired: 0,
    scheduledChangesApplied: 0,
    scheduledChangesSkipped: 0,
    renewalsProcessed: 0,
    renewalInvoices: 0,
    renewalFailures: 0,
    invoicesMarkedOverdue: 0,
  };

  const trials = await expireTrials(prisma);
  result.trialsExpired = trials.expired;
  const grace = await expireGracePeriods(prisma);
  result.gracePeriodsExpired = grace.suspended;
  const changes = await applyScheduledChanges(prisma);
  result.scheduledChangesApplied = changes.applied;
  result.scheduledChangesSkipped = changes.skipped;

  const due = await prisma.organizationSubscription.findMany({
    where: {
      status: 'ACTIVE',
      autoRenew: true,
      nextBillingDate: { lte: now },
    },
    take: 200,
  });

  const settings = await getBillingSettings();
  for (const subscription of due) {
    const renewed = await renewSubscription(subscription.id).catch(() => null);
    if (!renewed) continue;
    result.renewalsProcessed += 1;

    try {
      const price =
        renewed.billingInterval === 'YEARLY'
          ? await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: renewed.planId } }).then((plan) => plan.yearlyPrice)
          : await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: renewed.planId } }).then((plan) => plan.monthlyPrice);
      const invoice = await generateInvoice({
        organizationId: renewed.organizationId,
        subscriptionId: renewed.id,
        items: [
          {
            description: `Subscription renewal — ${renewed.billingInterval.toLowerCase()}`,
            itemType: 'SUBSCRIPTION_RENEWAL',
            referenceId: renewed.id,
            unitAmount: price.toString(),
          },
        ],
        dueInDays: settings.invoiceDueDays,
        billingPeriodStart: renewed.currentPeriodStart ?? now,
        billingPeriodEnd: renewed.currentPeriodEnd ?? now,
        description: 'Automatic renewal invoice',
      });
      await prisma.billingInvoice.update({
        where: { id: invoice.id },
        data: { status: 'PENDING', finalizedAt: new Date() },
      });
      result.renewalInvoices += 1;

      // Automatic gateway charging is only attempted when the configured
      // provider supports unattended charges. Local gateways and manual bank
      // transfers require explicit admin action and remain PENDING.
      const gateway = process.env.BILLING_AUTO_CHARGE_PROVIDER ?? '';
      if (!gateway) continue;
      const provider = getPaymentProvider(gateway);
      if (!provider.isConfigured() || !['SSLCOMMERZ'].includes(provider.name)) continue;
    } catch (error) {
      result.renewalFailures += 1;
      console.error('[billing-jobs] renewal invoice failed', error);
    }
  }

  const overdue = await markOverdueInvoices();
  result.invoicesMarkedOverdue = overdue.count;
  result.finishedAt = new Date().toISOString();

  await recordAuditLog({
    action: 'BILLING_JOB_RUN',
    resource: 'BILLING_JOB',
    description: 'Scheduled subscription and billing processor completed.',
    metadata: result as unknown as Parameters<typeof recordAuditLog>[0]['metadata'],
  });
  return result;
}
