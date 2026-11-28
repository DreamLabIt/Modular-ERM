'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertPlatformAdmin } from '@/core/auth/platform';
import { toUserErrorMessage } from '@/core/errors';
import { createPlan, updatePlan, setPlanActive } from '@/core/billing/plans';
import {
  extendTrial,
  activatePaidSubscription,
  suspendOrExpire,
  reactivateSubscription,
} from '@/core/billing/subscriptions';
import { approveManualPayment } from '@/core/billing/payments/service';
import { saveBillingSettings, DEFAULT_BILLING_SETTINGS } from '@/core/billing/analytics';
import { platformAudit } from '@/core/billing/audit';
import { prisma } from '@/core/db/prisma';

async function run(target: string, fn: () => Promise<void>, success?: string) {
  try {
    await fn();
    revalidatePath('/platform-admin', 'layout');
  } catch (error) {
    redirect(`${target}?error=${encodeURIComponent(toUserErrorMessage(error))}`);
  }
  redirect(`${target}${success ? `?success=${encodeURIComponent(success)}` : ''}`);
}

function bool(value: FormDataEntryValue | null) {
  return value === 'on' || value === 'true' || value === '1';
}

function optionalInt(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function planFromForm(formData: FormData) {
  const modules = formData.getAll('moduleKey').map(String);
  const included = new Set(formData.getAll('included').map(String));
  return {
    name: String(formData.get('name') || ''),
    slug: String(formData.get('slug') || ''),
    description: String(formData.get('description') || ''),
    currency: String(formData.get('currency') || 'BDT'),
    monthlyPrice: String(formData.get('monthlyPrice') || '0'),
    yearlyPrice: String(formData.get('yearlyPrice') || '0'),
    trialDays: Number(formData.get('trialDays') || 14),
    allowedIntervals: formData.getAll('interval').map(String),
    maxEmployees: optionalInt(formData.get('maxEmployees')),
    maxUsers: optionalInt(formData.get('maxUsers')),
    maxProjects: optionalInt(formData.get('maxProjects')),
    maxStorageMb: optionalInt(formData.get('maxStorageMb')),
    maxApiCalls: optionalInt(formData.get('maxApiCalls')),
    isActive: bool(formData.get('isActive')),
    isPublic: bool(formData.get('isPublic')),
    sortOrder: Number(formData.get('sortOrder') || 0),
    isRecommended: bool(formData.get('isRecommended')),
    features: { description: String(formData.get('featureSummary') || '') },
    modules: modules.map((moduleKey) => ({
      moduleKey,
      isIncluded: included.has(moduleKey),
      monthlyPrice: String(formData.get(`moduleMonthly_${moduleKey}`) || '0'),
      yearlyPrice: String(formData.get(`moduleYearly_${moduleKey}`) || '0'),
    })),
  };
}

export async function savePlanAction(formData: FormData): Promise<void> {
  const admin = await assertPlatformAdmin();
  const id = String(formData.get('id') || '');
  await run('/platform-admin/plans', async () => {
    const plan = planFromForm(formData);
    if (id) await updatePlan({ id, plan, actor: admin });
    else await createPlan({ plan, actor: admin });
  }, 'Plan saved.');
}

export async function togglePlanAction(formData: FormData): Promise<void> {
  const admin = await assertPlatformAdmin();
  await run('/platform-admin/plans', async () => {
    await setPlanActive({
      id: String(formData.get('id') || ''),
      isActive: bool(formData.get('isActive')),
      actor: admin,
    });
  }, 'Plan status updated.');
}

export async function assignSubscriptionAction(formData: FormData): Promise<void> {
  const admin = await assertPlatformAdmin();
  await run('/platform-admin/subscriptions', async () => {
    const organizationId = String(formData.get('organizationId') || '');
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new Error('Organization not found.');
    await activatePaidSubscription({
      organizationId,
      planId: String(formData.get('planId') || ''),
      interval: String(formData.get('interval') || 'MONTHLY'),
      paymentStatus: 'MANUAL_APPROVED',
      actorUserId: admin.id,
      actorEmail: admin.email,
    });
    await platformAudit({
      actor: admin,
      action: 'ORG_SUBSCRIPTION_MANUALLY_CHANGED',
      resource: 'ORGANIZATION',
      resourceId: organizationId,
    });
  }, 'Subscription assigned.');
}

export async function extendTrialAction(formData: FormData): Promise<void> {
  const admin = await assertPlatformAdmin();
  await run('/platform-admin/subscriptions', async () => {
    await extendTrial({
      organizationId: String(formData.get('organizationId') || ''),
      days: Number(formData.get('days') || 7),
      actor: admin,
    });
  }, 'Trial extended.');
}

export async function changeSubscriptionStatusAction(formData: FormData): Promise<void> {
  const admin = await assertPlatformAdmin();
  await run('/platform-admin/subscriptions', async () => {
    const status = String(formData.get('status') || '');
    const organizationId = String(formData.get('organizationId') || '');
    if (status === 'REACTIVATE') {
      await reactivateSubscription({ organizationId, actor: admin });
    } else if (status === 'SUSPENDED' || status === 'EXPIRED') {
      await suspendOrExpire({ organizationId, status, actor: admin });
    } else {
      throw new Error('Unsupported status action.');
    }
  }, 'Subscription status updated.');
}

export async function approveManualPaymentAction(formData: FormData): Promise<void> {
  const admin = await assertPlatformAdmin();
  await run('/platform-admin/payments', async () => {
    await approveManualPayment({
      organizationId: String(formData.get('organizationId') || ''),
      paymentId: String(formData.get('paymentId') || ''),
      admin,
    });
  }, 'Payment approved.');
}

export async function saveBillingSettingsAction(formData: FormData): Promise<void> {
  const admin = await assertPlatformAdmin();
  await run('/platform-admin/settings', async () => {
    await saveBillingSettings({
      graceDays: Number(formData.get('graceDays') ?? DEFAULT_BILLING_SETTINGS.graceDays),
      invoiceDueDays: Number(formData.get('invoiceDueDays') ?? DEFAULT_BILLING_SETTINGS.invoiceDueDays),
      retryDays: String(formData.get('retryDays') || '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
      prorationPolicy: String(formData.get('prorationPolicy') || DEFAULT_BILLING_SETTINGS.prorationPolicy),
      refundPolicy: String(formData.get('refundPolicy') || DEFAULT_BILLING_SETTINGS.refundPolicy),
      trialPrevention: bool(formData.get('trialPrevention')),
    });
    await platformAudit({
      actor: admin,
      action: 'BILLING_SETTINGS_UPDATED',
      resource: 'PLATFORM_SETTING',
      resourceId: 'billing_settings',
    });
  }, 'Billing settings saved.');
}

export async function saveGatewayConfigAction(formData: FormData): Promise<void> {
  const admin = await assertPlatformAdmin();
  await run('/platform-admin/gateways', async () => {
    const provider = String(formData.get('provider') || '');
    const config = {
      environment: String(formData.get('environment') || 'SANDBOX'),
      supportEmail: String(formData.get('supportEmail') || ''),
    };
    await prisma.paymentGatewayConfiguration.upsert({
      where: { provider },
      update: {
        isEnabled: bool(formData.get('isEnabled')),
        environment: config.environment,
        config,
      },
      create: {
        provider,
        displayName: String(formData.get('displayName') || provider),
        isEnabled: bool(formData.get('isEnabled')),
        environment: config.environment,
        config,
      },
    });
    await platformAudit({
      actor: admin,
      action: 'GATEWAY_CONFIG_UPDATED',
      resource: 'PAYMENT_GATEWAY_CONFIGURATION',
      resourceId: provider,
    });
  }, 'Gateway configuration saved. Credentials remain environment-only.');
}
