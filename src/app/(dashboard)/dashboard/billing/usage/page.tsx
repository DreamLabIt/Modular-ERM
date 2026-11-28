import { assertBillingAccess } from '../actions';
import { getBillingOverview } from '@/core/billing/entitlements';

export const dynamic = 'force-dynamic';

export default async function BillingUsagePage() {
  const { tenant } = await assertBillingAccess();
  const overview = await getBillingOverview(tenant.organizationId);
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Usage & Limits</h1><p className="text-sm text-slate-500">Counts are calculated server-side from live records and metered usage.</p></div>
      <section className="grid gap-4 md:grid-cols-3">
        {overview.quotas.map((quota) => (
          <div key={quota.category} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold uppercase text-slate-500">{quota.category.replace('_', ' ')}</div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{quota.used}</div>
            <div className="text-xs text-slate-500">of {quota.limit ?? 'unlimited'}</div>
            <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100"><div className={`h-full ${quota.percentage !== null && quota.percentage > 85 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${quota.percentage ?? 5}%` }} /></div>
          </div>
        ))}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Enabled modules</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from(new Set([...overview.entitlements.includedModules, ...overview.entitlements.paidModules])).map((module) => (
            <span key={module} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium">{module}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
