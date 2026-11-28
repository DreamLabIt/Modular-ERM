import { requirePlatformAdmin } from '@/core/auth/platform';
import { getPlatformAnalytics } from '@/core/billing/analytics';

export const dynamic = 'force-dynamic';

export default async function PlatformAnalyticsPage() {
  await requirePlatformAdmin();
  const analytics = await getPlatformAnalytics();
  const rows: Array<[string, string]> = [
    ['MRR (active subscriptions, yearly ÷ 12)', analytics.mrr],
    ['ARR (MRR × 12)', analytics.arr],
    ['Total collected payments (all-time, not MRR)', analytics.totalCollected],
    ['Outstanding invoice balance', analytics.outstandingInvoices],
    ['Trial conversion rate', `${analytics.trialConversionRate}%`],
    ['Upcoming renewals (30 days)', String(analytics.upcomingRenewals)],
  ];
  return (
    <div className="space-y-6 pb-12">
      <h1 className="text-2xl font-bold text-slate-900">Subscription Analytics</h1>
      <p className="max-w-2xl text-sm text-slate-500">MRR/ARR are calculated only from entitled recurring subscriptions. Payments and one-time charges are reported separately.</p>
      <section className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 p-4 text-sm">
            <span className="text-slate-600">{label}</span>
            <span className="font-semibold text-slate-900">{value}</span>
          </div>
        ))}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Plan distribution</h2>
        <div className="space-y-2">
          {analytics.planCounts.map((plan) => (
            <div key={plan.name} className="flex items-center justify-between text-sm">
              <span>{plan.name}</span>
              <div className="flex items-center gap-3">
                <div className="h-2 w-32 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-blue-600" style={{ width: `${Math.min(100, analytics.organizations ? (plan.subscriptions / analytics.organizations) * 100 : 0)}%` }} />
                </div>
                <span className="w-8 text-right text-xs text-slate-500">{plan.subscriptions}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
