import { assertBillingAccess } from '../actions';
import { listPlans } from '@/core/billing/plans';
import { getOrganizationEntitlements } from '@/core/billing/entitlements';
import { startTrialAction, requestPlanChangeAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function BillingPlansPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { tenant, canManage } = await assertBillingAccess();
  const [plans, entitlements] = await Promise.all([
    listPlans(),
    getOrganizationEntitlements(tenant.organizationId),
  ]);
  const requestedModule = typeof searchParams.module === 'string' ? searchParams.module : '';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Plans & Entitlements</h1>
        <p className="text-sm text-slate-500">Prices and limits are set by platform administration. Your current plan: {entitlements.planName}.</p>
      </div>
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      {requestedModule && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Module <strong>{requestedModule}</strong> is not included in your current subscription.</div>}
      {!entitlements.hasSubscription && canManage && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-semibold text-slate-900">Start your free trial</h2>
          <form action={startTrialAction} className="mt-3 flex flex-wrap gap-3">
            <select name="planId" className="rounded border border-slate-300 px-3 py-2 text-sm" required>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} ({plan.trialDays}-day trial)</option>)}
            </select>
            <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Start trial</button>
          </form>
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const current = plan.id === entitlements.planId;
          return (
            <div key={plan.id} className={`flex flex-col rounded-xl border bg-white p-5 shadow-sm ${plan.isRecommended ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'}`}>
              {plan.isRecommended && <span className="mb-2 w-fit rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">RECOMMENDED</span>}
              <h2 className="text-lg font-bold text-slate-900">{plan.name}</h2>
              <p className="mt-1 min-h-[36px] text-xs text-slate-500">{plan.description ?? ''}</p>
              <div className="mt-3 text-2xl font-bold">{plan.currency} {plan.monthlyPrice.toString()}<span className="text-xs font-normal text-slate-500"> / month</span></div>
              <div className="text-xs text-slate-500">{plan.currency} {plan.yearlyPrice.toString()} / year</div>
              <ul className="mt-4 flex-1 space-y-1 text-xs text-slate-600">
                <li>Employees: {plan.maxEmployees ?? 'Unlimited'}</li>
                <li>Users: {plan.maxUsers ?? 'Unlimited'}</li>
                <li>Projects: {plan.maxProjects ?? 'Unlimited'}</li>
                <li>Storage: {plan.maxStorageMb ?? 'Unlimited'} MB</li>
                <li>API calls: {plan.maxApiCalls ?? 'Unlimited'}</li>
                <li className="pt-1 font-semibold">Included modules: {plan.modules.filter((m) => m.isIncluded).map((m) => m.moduleKey).join(', ') || 'None'}</li>
              </ul>
              {canManage && !current && (
                <form action={requestPlanChangeAction} className="mt-5 space-y-2">
                  <input type="hidden" name="planId" value={plan.id} />
                  <select name="interval" className="w-full rounded border px-2 py-1 text-xs">
                    {(plan.allowedIntervals || 'MONTHLY,YEARLY').split(',').map((interval) => <option key={interval}>{interval}</option>)}
                  </select>
                  <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                    Change plan
                  </button>
                </form>
              )}
              {current && <div className="mt-5 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold">Current plan</div>}
            </div>
          );
        })}
        {plans.length === 0 && <p className="text-sm text-slate-500">No public plans are available. Contact platform administration.</p>}
      </div>
    </div>
  );
}
