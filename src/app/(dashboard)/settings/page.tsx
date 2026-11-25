import { requirePermission } from '@/core/auth/module-guard';
import { MODULE_REGISTRY } from '@/core/modules/registry';
import { updateBrandingAction, toggleModuleAction } from './actions';

export default async function SettingsPage() {
  const tenant = await requirePermission('settings.manage');

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">White-Label & Module Licensing</h1>
        <p className="text-sm text-slate-500">Configure client branding and enable/disable ERP modules.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Client Branding</h2>
        <form action={updateBrandingAction} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">Company Name</label>
            <input name="name" defaultValue={tenant.organization.name} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">Currency</label>
            <input name="currency" defaultValue={tenant.organization.currency} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">Brand Primary Color</label>
            <input type="color" name="primaryColor" defaultValue={tenant.organization.primaryColor} className="mt-1 h-10 w-24 rounded border border-slate-300 p-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">Address</label>
            <input name="address" placeholder="Dhaka, Bangladesh" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
              Save Branding
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">All 9 ERP Modules (License Switcher)</h2>
        <div className="divide-y divide-slate-200">
          {Object.values(MODULE_REGISTRY).map((mod) => {
            const isEnabled = tenant.enabledModules.includes(mod.key);
            return (
              <div key={mod.key} className="py-3.5 flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-slate-900 text-sm">{mod.name}</div>
                  <div className="text-xs text-slate-500">{mod.description}</div>
                </div>
                <form
                  action={async () => {
                    'use server';
                    await toggleModuleAction(mod.key, !isEnabled);
                  }}
                >
                  <button
                    type="submit"
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${
                      isEnabled ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
