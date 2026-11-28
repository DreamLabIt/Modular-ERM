'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequiredTenantSession } from '@/core/auth/session';
import { hasPermission } from '@/lib/permissions';
import { toUserErrorMessage } from '@/core/errors';
import { startTrial, changePlan, cancelSubscription, setAutoRenew } from '@/core/billing/subscriptions';
import { getOrganizationEntitlements } from '@/core/billing/entitlements';
import { purchaseModule } from '@/core/billing/plans';
import { initiatePayment } from '@/core/billing/payments/service';
import { prisma } from '@/core/db/prisma';

async function run(fn: () => Promise<void>, success?: string) {
  try {
    await fn();
    revalidatePath('/dashboard/billing', 'layout');
    revalidatePath('/', 'layout');
  } catch (error) {
    redirect(`/dashboard/billing?error=${encodeURIComponent(toUserErrorMessage(error))}`);
  }
  redirect(`/dashboard/billing${success ? `?success=${encodeURIComponent(success)}` : ''}`);
}

async function tenantWithBilling() {
  const tenant = await getRequiredTenantSession();
  if (!hasPermission(tenant.authorization, 'billing.manage')) {
    throw new Error('You do not have permission to manage billing.');
  }
  return tenant;
}

export async function startTrialAction(formData: FormData): Promise<void> {
  const tenant = await tenantWithBilling();
  await run(async () => {
    await startTrial({
      organizationId: tenant.organizationId,
      planId: String(formData.get('planId') || ''),
      actorUserId: tenant.userId,
      actorEmail: tenant.email,
    });
  }, 'Free trial started.');
}

export async function requestPlanChangeAction(formData: FormData): Promise<void> {
  const tenant = await tenantWithBilling();
  await run(async () => {
    const result = await changePlan({
      organizationId: tenant.organizationId,
      targetPlanId: String(formData.get('planId') || ''),
      interval: String(formData.get('interval') || undefined),
      actorUserId: tenant.userId,
      actorEmail: tenant.email,
    });
    if (result.mode === 'PAYMENT_REQUIRED') {
      const invoice = await prisma.billingInvoice.create({
        data: {
          organizationId: tenant.organizationId,
          subscriptionId: result.subscription.id,
          invoiceNumber: `UPG-${Date.now().toString().slice(-10)}`,
          status: 'PENDING',
          currency: result.target.currency,
          description: `Upgrade to ${result.target.name}`,
          subtotal: result.amount,
          totalAmount: result.amount,
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          finalizedAt: new Date(),
          items: {
            create: {
              description: `Plan upgrade — ${result.target.name}`,
              itemType: 'PLAN_UPGRADE',
              referenceId: result.target.id,
              quantity: 1,
              unitAmount: result.amount,
              amount: result.amount,
            },
          },
        },
      });
      await prisma.paymentAttempt.create({
        data: {
          organizationId: tenant.organizationId,
          provider: 'MANUAL_BANK',
          status: 'AWAITING_PAYMENT',
          reference: invoice.id,
        },
      });
    }
  }, 'Plan change recorded.');
}

export async function purchaseModuleAction(formData: FormData): Promise<void> {
  const tenant = await tenantWithBilling();
  await run(async () => {
    await purchaseModule({
      organizationId: tenant.organizationId,
      moduleKey: String(formData.get('moduleKey') || ''),
      interval: String(formData.get('interval') || 'MONTHLY') as 'MONTHLY' | 'YEARLY',
      actorUserId: tenant.userId,
      actorEmail: tenant.email,
    });
  }, 'Module added to your subscription.');
}

export async function setAutoRenewAction(formData: FormData): Promise<void> {
  const tenant = await tenantWithBilling();
  await run(async () => {
    await setAutoRenew({
      organizationId: tenant.organizationId,
      autoRenew: formData.get('autoRenew') === 'true' || formData.get('autoRenew') === 'on',
      actorUserId: tenant.userId,
      actorEmail: tenant.email,
    });
  }, 'Auto-renew updated.');
}

export async function cancelSubscriptionAction(formData: FormData): Promise<void> {
  const tenant = await tenantWithBilling();
  await run(async () => {
    await cancelSubscription({
      organizationId: tenant.organizationId,
      reason: String(formData.get('reason') || 'Cancelled by organization administrator'),
      actorUserId: tenant.userId,
      actorEmail: tenant.email,
    });
  }, 'Subscription cancelled.');
}

export async function initiatePaymentAction(formData: FormData): Promise<void> {
  const tenant = await tenantWithBilling();
  await run(async () => {
    const result = await initiatePayment({
      organizationId: tenant.organizationId,
      invoiceId: String(formData.get('invoiceId') || ''),
      provider: String(formData.get('provider') || 'MANUAL_BANK'),
      actorUserId: tenant.userId,
      actorEmail: tenant.email,
    });
    if ('checkoutUrl' in result && result.checkoutUrl) {
      redirect(result.checkoutUrl);
    }
  }, 'Payment initiated. Awaiting verification.');
}

export async function updateBillingProfileAction(formData: FormData): Promise<void> {
  const tenant = await tenantWithBilling();
  await run(async () => {
    const email = String(formData.get('billingEmail') || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid billing email.');
    await prisma.billingProfile.upsert({
      where: { organizationId: tenant.organizationId },
      update: {
        billingEmail: email,
        companyName: String(formData.get('companyName') || '').slice(0, 200),
        address: String(formData.get('address') || '').slice(0, 500),
        taxId: String(formData.get('taxId') || '').slice(0, 50),
        phone: String(formData.get('phone') || '').slice(0, 50),
      },
      create: {
        organizationId: tenant.organizationId,
        billingEmail: email,
        companyName: String(formData.get('companyName') || '').slice(0, 200),
        address: String(formData.get('address') || '').slice(0, 500),
        taxId: String(formData.get('taxId') || '').slice(0, 50),
        phone: String(formData.get('phone') || '').slice(0, 50),
      },
    });
  }, 'Billing information saved.');
}

export async function assertBillingAccess() {
  const tenant = await getRequiredTenantSession();
  if (!hasPermission(tenant.authorization, 'billing.view') && !hasPermission(tenant.authorization, 'billing.manage')) {
    redirect('/dashboard?error=unauthorized');
  }
  return { tenant, canManage: hasPermission(tenant.authorization, 'billing.manage') };
}

export async function currentEntitlements() {
  const tenant = await getRequiredTenantSession();
  return getOrganizationEntitlements(tenant.organizationId);
}
