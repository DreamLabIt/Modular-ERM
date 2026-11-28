import { prisma } from '@/core/db/prisma';
import { assertBillingAccess } from '../actions';
import { setAutoRenewAction, cancelSubscriptionAction, purchaseModuleAction } from '../actions';
import { MODULE_REGISTRY } from '@/core/modules/registry';

export const dynamic = 'force-dynamic';

export default async function SubscriptionPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { tenant, canManage } = await assertBillingAccess();
  const [subscription, history, scheduled] = await Promise.all([
    prisma.organizationSubscription.findUnique({
      where: { organizationId: tenant.organizationId },
      include: { plan: { include: { modules: true } }, modules: true },
    }),
    prisma.subscriptionHistory.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.scheduledPlanChange.findMany({ where: { organizationId: tenant.organizationId, status: 'SCHEDULED' } }),
  ]);
  const included = new Set(subscription?.plan.modules.filter((m) => m.isIncluded).map((m) => m.moduleKey) ?? []);
  const purchased = new Set(subscription?.modules.filter((m) => m.status === 'ACTIVE').map((m) => m.moduleKey) ?? []);
  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-bold text-slate-900">Subscription</h1><p className="text-sm text-slate-500">Lifecycle, entitlements and history for your organization.</p></div>
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {!subscription ? <p className="text-sm text-slate-600">No subscription yet. <a className="text-blue-600 hover:underline" href="/dashboard/billing/plans">Choose a plan</a>.</p> : (
          <div className="grid gap-4 md:grid-cols-3">
            <div><div className="text-[11px] uppercase text-slate-500">Plan</div><div className="mt-1 font-semibold">{subscription.plan.name}</div></div>
            <div><div className="text-[11px] uppercase text-slate-500">Status</div><div className="mt-1 font-semibold">{subscription.status}</div></div>
            <div><div className="text-[11px] uppercase text-slate-500">Billing interval</div><div className="mt-1 font-semibold">{subscription.billingInterval}</div></div>
            <div><div className="text-[11px] uppercase text-slate-500">Trial ends</div><div className="mt-1 text-sm">{subscription.trialEnd?.toISOString().slice(0, 10) ?? '—'}</div></div>
            <div><div className="text-[11px] uppercase text-slate-500">Next billing</div><div className="mt-1 text-sm">{subscription.nextBillingDate?.toISOString().slice(0, 10) ?? '—'}</div></div>
            <div><div className="text-[11px] uppercase text-slate-500">Grace period</div><div className="mt-1 text-sm">{subscription.gracePeriodEnd?.toISOString().slice(0, 10) ?? '—'}</div></div>
          </div>
        )}
        {subscription && canManage && (
          <div className="mt-6 flex flex-wrap gap-4 border-t pt-4">
            <form action={setAutoRenewAction}>
              <input type="hidden" name="autoRenew" value={subscription.autoRenew ? 'false' : 'true'} />
              <button type="submit" className="rounded-lg border px-3 py-1.5 text-xs font-semibold">{subscription.autoRenew ? 'Disable auto-renew' : 'Enable auto-renew'}</button>
            </form>
            <form action={cancelSubscriptionAction} className="flex gap-2">
              <input name="reason" placeholder="Cancellation reason" className="rounded border px-2 py-1 text-xs" />
              <button type="submit" className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700">Cancel subscription</button>
            </form>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Modules</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {Object.entries(MODULE_REGISTRY).map(([key, module]) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-xs">
              <div><div className="font-semibold">{module.name}</div><div className="text-slate-500">{included.has(key) ? 'Included in plan' : purchased.has(key) ? 'Purchased' : 'Not available'}</div></div>
              {canManage && subscription && !included.has(key) && !purchased.has(key) && (
                <form action={purchaseModuleAction} className="flex gap-1">
                  <input type="hidden" name="moduleKey" value={key} />
                  <select name="interval" className="rounded border px-1 py-0.5 text-[11px]"><option>MONTHLY</option><option>YEARLY</option></select>
                  <button className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white">Add</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </section>

      {scheduled.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">Scheduled plan changes</h2>
          {scheduled.map((change) => <p key={change.id} className="mt-1 text-xs">{change.action} effective {change.effectiveAt.toISOString().slice(0, 10)} — {change.status}</p>)}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Subscription history</h2>
        <div className="mt-4 space-y-2 text-xs text-slate-600">
          {history.map((item) => <div key={item.id}>{item.createdAt.toISOString().slice(0, 16).replace('T', ' ')} · {item.action} · {item.planName} · {item.fromStatus ?? '—'} → {item.toStatus ?? '—'}</div>)}
          {history.length === 0 && <p>No history recorded.</p>}
        </div>
      </section>
    </div>
  );
}
