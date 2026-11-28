import { requirePlatformAdmin } from '@/core/auth/platform';
import { getBillingSettings } from '@/core/billing/analytics';
import { saveBillingSettingsAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PlatformBillingSettingsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePlatformAdmin();
  const settings = await getBillingSettings();
  return (
    <div className="max-w-3xl space-y-6 pb-12">
      <div><h1 className="text-2xl font-bold text-slate-900">Platform Billing Settings</h1><p className="text-sm text-slate-500">Defaults for grace periods, retries, invoices and policy documentation.</p></div>
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      <form action={saveBillingSettingsAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div><label className="block text-xs font-semibold">Grace period (days)</label><input name="graceDays" type="number" min="0" max="90" defaultValue={settings.graceDays} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs font-semibold">Invoice due (days)</label><input name="invoiceDueDays" type="number" min="1" max="90" defaultValue={settings.invoiceDueDays} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
          <div className="md:col-span-2"><label className="block text-xs font-semibold">Retry schedule (comma-separated days)</label><input name="retryDays" defaultValue={settings.retryDays.join(',')} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs font-semibold">Proration policy</label><input name="prorationPolicy" defaultValue={settings.prorationPolicy} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs font-semibold">Refund policy</label><input name="refundPolicy" defaultValue={settings.refundPolicy} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
        </div>
        <label className="flex items-center gap-2 text-xs"><input name="trialPrevention" type="checkbox" defaultChecked={settings.trialPrevention} />Prevent repeated free trials per organization</label>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Save settings</button>
      </form>
    </div>
  );
}
