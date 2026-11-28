import { requirePlatformAdmin } from '@/core/auth/platform';
import { listPaymentProviders } from '@/core/billing/payments/providers';
import { prisma } from '@/core/db/prisma';
import { saveGatewayConfigAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PlatformGatewaysPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePlatformAdmin();
  const providers = listPaymentProviders();
  const configurations = await prisma.paymentGatewayConfiguration.findMany();
  return (
    <div className="space-y-6 pb-12">
      <div><h1 className="text-2xl font-bold text-slate-900">Payment Gateways</h1><p className="text-sm text-slate-500">Secrets are environment-only. This page stores non-secret public configuration.</p></div>
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((provider) => {
          const config = configurations.find((item) => item.provider === provider.name);
          return (
            <form key={provider.name} action={saveGatewayConfigAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <input type="hidden" name="provider" value={provider.name} />
              <input type="hidden" name="displayName" value={provider.displayName} />
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">{provider.displayName}</h2>
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${provider.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {provider.configured ? 'CREDENTIALS PRESENT' : 'NOT CONFIGURED'}
                </span>
              </div>
              {!provider.supported && <p className="rounded bg-amber-50 p-2 text-[11px] text-amber-800">Adapter only: live checkout is not enabled until the gateway callback contract is implemented and verified.</p>}
              {provider.name === 'SSLCOMMERZ' && <p className="text-[11px] text-slate-500">Set SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWORD, SSLCOMMERZ_WEBHOOK_SECRET and SSLCOMMERZ_ENVIRONMENT in the environment.</p>}
              <div><label className="block text-[11px] font-semibold">Environment</label><select name="environment" defaultValue={config?.environment ?? 'SANDBOX'} className="mt-1 w-full rounded border px-2 py-1 text-xs"><option>SANDBOX</option><option>LIVE</option></select></div>
              <div><label className="block text-[11px] font-semibold">Support email (public)</label><input name="supportEmail" defaultValue={(config?.config as { supportEmail?: string } | null)?.supportEmail ?? ''} className="mt-1 w-full rounded border px-2 py-1 text-xs" /></div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="isEnabled" defaultChecked={config?.isEnabled ?? false} />Enabled</label>
              <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Save configuration</button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
