import { prisma } from '@/core/db/prisma';
import { getActiveSubscription, ENTITLED_STATUSES, type BillingInterval } from './subscriptions';
import { getOrganizationUsage } from './usage';

export interface PlanLimits {
  maxEmployees: number | null;
  maxUsers: number | null;
  maxProjects: number | null;
  maxStorageMb: number | null;
  maxApiCalls: number | null;
}

export interface OrganizationEntitlements {
  hasSubscription: boolean;
  entitled: boolean;
  source: 'TRIAL' | 'PAID' | 'NONE';
  status: string;
  planId: string | null;
  planName: string;
  slug: string | null;
  currency: string;
  billingInterval: BillingInterval | null;
  trialEnd: Date | null;
  nextBillingDate: Date | null;
  paymentStatus: string;
  includedModules: string[];
  paidModules: string[];
  limits: PlanLimits;
  features: Record<string, unknown>;
}

const EMPTY_ENTITLEMENTS: OrganizationEntitlements = {
  hasSubscription: false,
  entitled: false,
  source: 'NONE',
  status: 'NONE',
  planId: null,
  planName: 'No plan',
  slug: null,
  currency: 'BDT',
  billingInterval: null,
  trialEnd: null,
  nextBillingDate: null,
  paymentStatus: 'NONE',
  includedModules: [],
  paidModules: [],
  limits: {
    maxEmployees: null,
    maxUsers: null,
    maxProjects: null,
    maxStorageMb: null,
    maxApiCalls: null,
  },
  features: {},
};

export async function getOrganizationEntitlements(
  organizationId: string,
): Promise<OrganizationEntitlements> {
  const subscription = await getActiveSubscription(organizationId);
  if (!subscription) return EMPTY_ENTITLEMENTS;

  const entitled = ENTITLED_STATUSES.includes(subscription.status as never);
  const included = await prisma.planModule.findMany({
    where: { planId: subscription.planId, isIncluded: true },
    select: { moduleKey: true },
  });
  const features =
    subscription.plan.features && typeof subscription.plan.features === 'object' && !Array.isArray(subscription.plan.features)
      ? (subscription.plan.features as Record<string, unknown>)
      : {};

  return {
    hasSubscription: true,
    entitled,
    source: subscription.status === 'TRIALING' ? 'TRIAL' : 'PAID',
    status: subscription.status,
    planId: subscription.planId,
    planName: subscription.plan.name,
    slug: subscription.plan.slug,
    currency: subscription.plan.currency,
    billingInterval: subscription.billingInterval as BillingInterval,
    trialEnd: subscription.trialEnd,
    nextBillingDate: subscription.nextBillingDate,
    paymentStatus: subscription.paymentStatus,
    includedModules: included.map((module) => module.moduleKey),
    paidModules: entitled ? subscription.modules.map((module) => module.moduleKey) : [],
    limits: {
      maxEmployees: subscription.plan.maxEmployees,
      maxUsers: subscription.plan.maxUsers,
      maxProjects: subscription.plan.maxProjects,
      maxStorageMb: subscription.plan.maxStorageMb,
      maxApiCalls: subscription.plan.maxApiCalls,
    },
    features,
  };
}

/**
 * Server-side module authorization. A module is accessible only when it is
 * both entitled (included in the plan or separately purchased) and enabled on
 * the OrganizationModule record. Hiding a nav item is not authorization.
 */
export async function canAccessModule(organizationId: string, moduleKey: string): Promise<boolean> {
  const [entitlements, organizationModule] = await Promise.all([
    getOrganizationEntitlements(organizationId),
    prisma.organizationModule.findUnique({
      where: { organizationId_moduleKey: { organizationId, moduleKey } },
      select: { isEnabled: true },
    }),
  ]);
  if (!organizationModule?.isEnabled) return false;
  if (!entitlements.entitled) return false;
  return (
    entitlements.includedModules.includes(moduleKey) ||
    entitlements.paidModules.includes(moduleKey)
  );
}

export interface BillingOverview {
  entitlements: OrganizationEntitlements;
  usage: Awaited<ReturnType<typeof getOrganizationUsage>>;
  quotas: Array<{
    category: keyof Awaited<ReturnType<typeof getOrganizationUsage>>;
    used: number;
    limit: number | null;
    percentage: number | null;
  }>;
}

export async function getBillingOverview(organizationId: string): Promise<BillingOverview> {
  const entitlements = await getOrganizationEntitlements(organizationId);
  const usage = await getOrganizationUsage(organizationId);
  const limitMap: Record<string, number | null> = {
    EMPLOYEES: entitlements.limits.maxEmployees,
    USERS: entitlements.limits.maxUsers,
    PROJECTS: entitlements.limits.maxProjects,
    STORAGE_MB: entitlements.limits.maxStorageMb,
    API_CALLS: entitlements.limits.maxApiCalls,
    INVOICES: null,
    WAREHOUSES: null,
  };
  const quotas = (Object.keys(usage) as Array<keyof typeof usage>).map((category) => {
    const limit = limitMap[category] ?? null;
    return {
      category,
      used: usage[category],
      limit,
      percentage: limit && limit > 0 ? Math.min(100, Math.round((usage[category] / limit) * 100)) : null,
    };
  });
  return { entitlements, usage, quotas };
}
