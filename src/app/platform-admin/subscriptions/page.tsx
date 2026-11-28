import { requirePlatformAdmin } from '@/core/auth/platform';
import { prisma } from '@/core/db/prisma';
import { listPlans } from '@/core/billing/plans';
import { assignSubscriptionAction, extendTrialAction, changeSubscriptionStatusAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PlatformSubscriptionsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePlatformAdmin();
  const status = typeof searchParams.status === 'string' ? searchParams.status : '';
  const [subscriptions, organizations, plans, history] = await Promise.all([
    prisma.organizationSubscription.findMany({
      where: status ? { status } : {},
      include: { organization: true, plan: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    listPlans({ includeInactive: true }),
    prisma.subscriptionHistory.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
  ]);
  const th = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase text-slate-500';
  const input = 'rounded-lg border border-slate-300 px-2 py-1 text-xs';
  return (
    <div className="space-y-8 pb-12">
      <div><h1 className="text-2xl font-bold text-slate-900">Subscriptions</h1><p className="text-sm text-slate-500">Assign plans, manage trials and apply platform policy.</p></div>
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Assign or change a subscription</h2>
        <form action={assignSubscriptionAction} className="flex flex-wrap items-end gap-3">
          <div><label className="block text-[11px] font-semibold">Organization</label><select name="organizationId" required className={input}>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></div>
          <div><label className="block text-[11px] font-semibold">Plan</label><select name="planId" required className={input}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
          <div><label className="block text-[11px] font-semibold">Interval</label><select name="interval" className={input}><option>MONTHLY</option><option>YEARLY</option></select></div>
          <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">Assign (manual approval)</button>
        </form>
      </section>
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead><tr><th className={th}>Organization</th><th className={th}>Plan</th><th className={th}>Status</th><th className={th}>Interval</th><th className={th}>Trial ends</th><th className={th}>Next billing</th><th className={th}>Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {subscriptions.map((sub) => (
              <tr key={sub.id}>
                <td className="py-2 pr-3 font-medium">{sub.organization.name}</td>
                <td className="py-2 pr-3">{sub.plan.name}</td>
                <td className="py-2 pr-3">{sub.status}</td>
                <td className="py-2 pr-3">{sub.billingInterval}</td>
                <td className="py-2 pr-3">{sub.trialEnd?.toISOString().slice(0, 10) ?? '—'}</td>
                <td className="py-2 pr-3">{sub.nextBillingDate?.toISOString().slice(0, 10) ?? '—'}</td>
                <td className="py-2 pr-3 flex flex-wrap gap-2">
                  {sub.status === 'TRIALING' && (
                    <form action={extendTrialAction}><input type="hidden" name="organizationId" value={sub.organizationId} /><input type="hidden" name="days" value="7" /><button className="text-blue-600 hover:underline">+7d trial</button></form>
                  )}
                  {['SUSPENDED', 'GRACE_PERIOD', 'PAST_DUE'].includes(sub.status) && (
                    <form action={changeSubscriptionStatusAction}><input type="hidden" name="organizationId" value={sub.organizationId} /><input type="hidden" name="status" value="REACTIVATE" /><button className="text-emerald-700 hover:underline">Reactivate</button></form>
                  )}
                  {['ACTIVE', 'TRIALING', 'GRACE_PERIOD'].includes(sub.status) && (
                    <form action={changeSubscriptionStatusAction}><input type="hidden" name="organizationId" value={sub.organizationId} /><input type="hidden" name="status" value="SUSPENDED" /><button className="text-red-600 hover:underline">Suspend</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent subscription history</h2>
        <div className="space-y-1 text-xs text-slate-600">
          {history.map((item) => (
            <div key={item.id}>{item.createdAt.toISOString().slice(0, 16).replace('T', ' ')} · {item.planName} · {item.action} · {item.fromStatus ?? '—'} → {item.toStatus ?? '—'}</div>
          ))}
        </div>
      </section>
    </div>
  );
}
