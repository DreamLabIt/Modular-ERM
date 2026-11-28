import Link from 'next/link';
import { getBillingOverview } from '@/core/billing/entitlements';
import { listInvoicesForOrganization } from '@/core/billing/invoices';
import { listPaymentsForOrganization } from '@/core/billing/payments/service';
import { assertBillingAccess } from './actions';

export const dynamic = 'force-dynamic';

export default async function BillingOverviewPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { tenant, canManage } = await assertBillingAccess();
  const [overview, invoices, payments] = await Promise.all([
    getBillingOverview(tenant.organizationId),
    listInvoicesForOrganization(tenant.organizationId, 10),
    listPaymentsForOrganization(tenant.organizationId, 10),
  ]);
  const { entitlements, quotas } = overview;
  const outstanding = invoices
    .filter((invoice) => ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status))
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount) - Number(invoice.amountPaid), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Billing & Subscription</h1>
          <p className="text-sm text-slate-500">Plan, usage and payments for {tenant.organization.name}.</p>
        </div>
        {canManage && <Link href="/dashboard/billing/plans" className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Change plan</Link>}
      </div>
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase text-slate-500">Current plan</div>
          <div className="mt-2 text-xl font-bold text-slate-900">{entitlements.planName}</div>
          <div className="mt-1 text-xs text-slate-500">Status: {entitlements.status} · {entitlements.billingInterval ?? '—'}</div>
          <div className="mt-1 text-xs text-slate-500">Next billing: {entitlements.nextBillingDate?.toISOString().slice(0, 10) ?? '—'}</div>
          {entitlements.trialEnd && <div className="mt-1 text-xs text-amber-700">Trial ends: {entitlements.trialEnd.toISOString().slice(0, 10)}</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase text-slate-500">Outstanding</div>
          <div className="mt-2 text-xl font-bold text-slate-900">{entitlements.currency} {outstanding.toFixed(2)}</div>
          <div className="mt-1 text-xs text-slate-500">{invoices.length} invoice(s) on record</div>
          <Link href="/dashboard/billing/invoices" className="mt-2 inline-block text-xs font-semibold text-blue-600">View invoices →</Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase text-slate-500">Payment status</div>
          <div className="mt-2 text-xl font-bold text-slate-900">{entitlements.paymentStatus}</div>
          <div className="mt-1 text-xs text-slate-500">{payments.length} payment record(s)</div>
          <Link href="/dashboard/billing/payments" className="mt-2 inline-block text-xs font-semibold text-blue-600">Payment history →</Link>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Usage against plan limits</h2>
        <div className="space-y-4">
          {quotas.map((quota) => (
            <div key={quota.category}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">{quota.category.replace('_', ' ')}</span>
                <span className="text-slate-500">{quota.used}{quota.limit !== null ? ` / ${quota.limit}` : ' / unlimited'}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
                <div className={`h-full ${quota.percentage !== null && quota.percentage > 85 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${quota.percentage ?? 5}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
