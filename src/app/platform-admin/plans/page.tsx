import { requirePlatformAdmin } from '@/core/auth/platform';
import { listPlans } from '@/core/billing/plans';
import { MODULE_REGISTRY } from '@/core/modules/registry';
import { savePlanAction, togglePlanAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PlatformPlansPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePlatformAdmin();
  const plans = await listPlans({ includeInactive: true });
  const input = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const label = 'block text-[11px] font-semibold text-slate-700';
  return (
    <div className="space-y-8 pb-12">
      <div><h1 className="text-2xl font-bold text-slate-900">Subscription Plans</h1><p className="text-sm text-slate-500">Prices, entitlements and module inclusions are database-driven.</p></div>
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      <section className="space-y-4">
        {plans.map((plan) => (
          <details key={plan.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
              <div>
                <span className="font-semibold text-slate-900">{plan.name}</span>
                <span className="ml-2 text-xs text-slate-500">{plan.slug}</span>
                <div className="text-xs text-slate-500">{plan.currency} {plan.monthlyPrice.toString()}/mo · {plan.yearlyPrice.toString()}/yr · {plan.trialDays}-day trial</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-slate-100 px-2 py-1">{plan.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
              </div>
            </summary>
            <form action={savePlanAction} className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
              <input type="hidden" name="id" value={plan.id} />
              <div><label className={label}>Name</label><input name="name" defaultValue={plan.name} className={input} /></div>
              <div><label className={label}>Slug</label><input name="slug" defaultValue={plan.slug} className={input} /></div>
              <div className="col-span-2"><label className={label}>Description</label><input name="description" defaultValue={plan.description ?? ''} className={input} /></div>
              <div><label className={label}>Currency</label><input name="currency" defaultValue={plan.currency} className={input} /></div>
              <div><label className={label}>Monthly price</label><input name="monthlyPrice" defaultValue={plan.monthlyPrice.toString()} className={input} /></div>
              <div><label className={label}>Yearly price</label><input name="yearlyPrice" defaultValue={plan.yearlyPrice.toString()} className={input} /></div>
              <div><label className={label}>Trial days</label><input name="trialDays" type="number" min="0" defaultValue={plan.trialDays} className={input} /></div>
              <div><label className={label}>Sort order</label><input name="sortOrder" type="number" defaultValue={plan.sortOrder} className={input} /></div>
              <div><label className={label}>Max employees</label><input name="maxEmployees" type="number" defaultValue={plan.maxEmployees ?? ''} className={input} /></div>
              <div><label className={label}>Max users</label><input name="maxUsers" type="number" defaultValue={plan.maxUsers ?? ''} className={input} /></div>
              <div><label className={label}>Max projects</label><input name="maxProjects" type="number" defaultValue={plan.maxProjects ?? ''} className={input} /></div>
              <div><label className={label}>Max storage (MB)</label><input name="maxStorageMb" type="number" defaultValue={plan.maxStorageMb ?? ''} className={input} /></div>
              <div><label className={label}>Max API calls</label><input name="maxApiCalls" type="number" defaultValue={plan.maxApiCalls ?? ''} className={input} /></div>
              <div>
                <label className={label}>Billing intervals</label>
                <div className="mt-2 flex gap-3">
                  {['MONTHLY', 'YEARLY'].map((interval) => (
                    <label key={interval} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="interval" value={interval} defaultChecked={plan.allowedIntervals.split(',').includes(interval)} />{interval}
                    </label>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <label className={label}>Included modules (optional modules can be purchased separately)</label>
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
                  {Object.entries(MODULE_REGISTRY).map(([key, module]) => {
                    const included = plan.modules.find((item) => item.moduleKey === key);
                    return (
                      <label key={key} className="rounded-lg border border-slate-200 p-2 text-xs">
                        <input type="hidden" name="moduleKey" value={key} />
                        <span className="flex items-center gap-1 font-semibold">
                          <input type="checkbox" name="included" value={key} defaultChecked={included?.isIncluded ?? false} />{module.name}
                        </span>
                        <span className="mt-1 block text-[10px] text-slate-500">Monthly <input name={`moduleMonthly_${key}`} defaultValue={included?.monthlyPrice?.toString() ?? '0'} className="w-16 rounded border px-1" /> Yearly <input name={`moduleYearly_${key}`} defaultValue={included?.yearlyPrice?.toString() ?? '0'} className="w-16 rounded border px-1" /></span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="col-span-4 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={plan.isActive} />Active</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isPublic" defaultChecked={plan.isPublic} />Public</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isRecommended" defaultChecked={plan.isRecommended} />Recommended</label>
                <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Save Plan</button>
              </div>
            </form>
          </details>
        ))}
        {plans.length === 0 && <p className="text-sm text-slate-500">No plans configured. Run the seed command to create defaults.</p>}
      </section>
    </div>
  );
}
