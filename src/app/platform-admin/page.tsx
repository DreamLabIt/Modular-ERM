import Link from 'next/link';
import { requirePlatformAdmin } from '@/core/auth/platform';
import { getPlatformAnalytics } from '@/core/billing/analytics';

export const dynamic = 'force-dynamic';

const cards = [
  ['Total organizations', 'organizations'],
  ['Active subscriptions', 'activeSubscriptions'],
  ['Trial organizations', 'trialOrganizations'],
  ['Expired subscriptions', 'expiredSubscriptions'],
  ['Past-due subscriptions', 'pastDueSubscriptions'],
  ['MRR (normalised)', 'mrr'],
  ['ARR (MRR × 12)', 'arr'],
  ['Total collected', 'totalCollected'],
  ['Outstanding invoices', 'outstandingInvoices'],
  ['Failed payments', 'failedPayments'],
  ['Upcoming renewals (30d)', 'upcomingRenewals'],
  ['Trial conversion %', 'trialConversionRate'],
] as const;

export default async function PlatformOverviewPage() {
  await requirePlatformAdmin();
  const analytics = await getPlatformAnalytics();
  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Platform Overview</h1>
        <p className="text-sm text-slate-500">Subscription health and revenue across all organizations.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {cards.map(([label, key]) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-2 text-xl font-bold text-slate-900">{analytics[key]}</div>
          </div>
        ))}
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Subscriptions by plan</h2>
        <div className="mt-4 space-y-2">
          {analytics.planCounts.map((plan) => (
            <div key={plan.name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="font-medium">{plan.name}</span>
              <span>{plan.subscriptions} organization(s)</span>
            </div>
          ))}
          {analytics.planCounts.length === 0 && <p className="text-sm text-slate-500">No plans configured yet.</p>}
        </div>
        <Link href="/platform-admin/plans" className="mt-4 inline-block text-xs font-semibold text-blue-600 hover:underline">Manage plans →</Link>
      </section>
    </div>
  );
}
