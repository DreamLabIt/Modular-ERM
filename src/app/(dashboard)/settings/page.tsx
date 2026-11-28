import Link from 'next/link';
import { requirePermission } from '@/core/auth/module-guard';
import { pageMessage } from '@/core/auth/action';
import { ActionMessage, StatusBadge } from '@/core/ui/ActionMessage';
import { MODULE_REGISTRY } from '@/core/modules/registry';
import { prisma } from '@/core/db/prisma';
import {
  updateBrandingAction,
  toggleModuleAction,
  updateRegionalSettingsAction,
  updateCompanyProfileAction,
  saveTaxAction,
  deleteTaxAction,
  createFiscalYearAction,
  setCurrentFiscalYearAction,
  closeFiscalYearAction,
  reopenFiscalYearAction,
  saveDocumentSequenceAction,
} from './actions';
import {
  getOrganizationSettings,
  CURRENCY_DISPLAY_FORMATS,
  DATE_FORMATS,
  TIME_FORMATS,
} from '@/core/settings';
import {
  listTaxConfigurations,
  listFiscalYears,
  listDocumentSequences,
} from '@/core/settings/management';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SettingsPage({
  searchParams = {},
}: {
  searchParams?: SearchParams;
}) {
  const tenant = await requirePermission('settings.manage');
  const message = pageMessage(searchParams);
  const [organization, settings, taxes, fiscalYears, sequences] = await Promise.all([
    prisma.organization.findUnique({ where: { id: tenant.organizationId } }),
    getOrganizationSettings(tenant.organizationId),
    listTaxConfigurations(tenant.organizationId),
    listFiscalYears(tenant.organizationId),
    listDocumentSequences(tenant.organizationId),
  ]);

  const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const labelClass = 'block text-xs font-semibold text-slate-700';
  const buttonClass = 'px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700';

  return (
    <div className="max-w-6xl space-y-8 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Settings</h1>
          <p className="text-sm text-slate-500">
            Company profile, regional formats, finance configuration and module licensing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/settings/security" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Security & Audit →
          </Link>
          <Link href="/settings/data-management" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Data Management →
          </Link>
          <Link href="/workflows" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Workflows →
          </Link>
        </div>
      </div>

      <ActionMessage message={message} />

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Company Profile</h2>
        <form action={updateCompanyProfileAction} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Company Name</label>
            <input name="name" defaultValue={organization?.name ?? ''} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Registration Number</label>
            <input name="registrationNumber" defaultValue={organization?.registrationNumber ?? ''} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input name="email" type="email" defaultValue={organization?.email ?? ''} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input name="phone" defaultValue={organization?.phone ?? ''} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <input name="website" defaultValue={organization?.website ?? ''} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Tax ID</label>
            <input name="taxId" defaultValue={organization?.taxId ?? ''} className={inputClass} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Address</label>
            <input name="address" defaultValue={organization?.address ?? ''} className={inputClass} />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className={buttonClass}>Save Company Profile</button>
          </div>
        </form>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Regional & Finance Settings</h2>
        <p className="text-xs text-slate-500 mb-4">
          Currency, timezone and date formats apply to formatted output. Fiscal year settings drive document numbering.
        </p>
        <form action={updateRegionalSettingsAction} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Currency Code (ISO 4217)</label>
            <input name="currencyCode" defaultValue={settings.currencyCode} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Currency Symbol</label>
            <input name="currencySymbol" defaultValue={settings.currencySymbol} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Decimal Precision</label>
            <input name="decimalPrecision" type="number" min="0" max="6" defaultValue={settings.decimalPrecision} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Currency Display</label>
            <select name="currencyDisplayFormat" defaultValue={settings.currencyDisplayFormat} className={inputClass}>
              {CURRENCY_DISPLAY_FORMATS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Timezone (IANA)</label>
            <input name="timezone" defaultValue={settings.timezone} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Date Format</label>
            <select name="dateFormat" defaultValue={settings.dateFormat} className={inputClass}>
              {DATE_FORMATS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Time Format</label>
            <select name="timeFormat" defaultValue={settings.timeFormat} className={inputClass}>
              {TIME_FORMATS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Fiscal Year Start Month</label>
            <input name="fiscalYearStartMonth" type="number" min="1" max="12" defaultValue={settings.fiscalYearStartMonth} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Fiscal Year Start Day</label>
            <input name="fiscalYearStartDay" type="number" min="1" max="28" defaultValue={settings.fiscalYearStartDay} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Week Starts On (0=Sunday)</label>
            <input name="weekStartsOn" type="number" min="0" max="6" defaultValue={settings.weekStartsOn} className={inputClass} />
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 md:col-span-3">
            <input name="enforceSecurityNotifications" type="checkbox" defaultChecked={settings.enforceSecurityNotifications} className="h-4 w-4" />
            Security notifications cannot be disabled by users
          </label>
          <div className="md:col-span-3">
            <button type="submit" className={buttonClass}>Save Regional Settings</button>
          </div>
        </form>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Tax Configurations</h2>
        <div className="overflow-x-auto mb-5">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-2">Code</th><th>Name</th><th>Rate</th><th>Type</th><th>Status</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {taxes.map((tax) => (
                <tr key={tax.id}>
                  <td className="py-2 font-medium">{tax.code}</td>
                  <td>{tax.name}</td>
                  <td>{String(tax.rate)}%</td>
                  <td>{tax.taxType}</td>
                  <td><StatusBadge status={tax.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                  <td>
                    <form action={deleteTaxAction}>
                      <input type="hidden" name="id" value={tax.id} />
                      <button className="text-xs text-red-600 hover:underline" type="submit">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
              {taxes.length === 0 && <tr><td colSpan={6} className="py-3 text-slate-500">No tax configurations yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <form action={saveTaxAction} className="grid grid-cols-1 md:grid-cols-4 gap-3 border-t border-slate-100 pt-4">
          <div><label className={labelClass}>Name</label><input name="name" required className={inputClass} /></div>
          <div><label className={labelClass}>Code</label><input name="code" required className={inputClass} /></div>
          <div><label className={labelClass}>Rate (%)</label><input name="rate" type="number" step="0.0001" min="0" max="100" required className={inputClass} /></div>
          <div>
            <label className={labelClass}>Type</label>
            <select name="taxType" className={inputClass}>
              <option>VAT</option><option>SALES</option><option>INCOME</option><option>WITHHOLDING</option><option>OTHER</option>
            </select>
          </div>
          <div><label className={labelClass}>Effective From</label><input name="effectiveFrom" type="date" className={inputClass} /></div>
          <div><label className={labelClass}>Effective To</label><input name="effectiveTo" type="date" className={inputClass} /></div>
          <label className="flex items-center gap-2 text-xs"><input name="isInclusive" type="checkbox" className="h-4 w-4" />Inclusive</label>
          <label className="flex items-center gap-2 text-xs"><input name="isActive" type="checkbox" defaultChecked className="h-4 w-4" />Active</label>
          <div className="md:col-span-4"><button type="submit" className={buttonClass}>Add Tax</button></div>
        </form>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Fiscal Years</h2>
        <div className="space-y-2 mb-4">
          {fiscalYears.map((year) => (
            <div key={year.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div>
                <span className="font-semibold">{year.name}</span>{' '}
                <span className="text-slate-500">{year.startDate.toISOString().slice(0, 10)} → {year.endDate.toISOString().slice(0, 10)}</span>{' '}
                <StatusBadge status={year.status} />
                {year.isCurrent && <span className="ml-2 text-xs font-semibold text-blue-600">Current</span>}
              </div>
              <div className="flex gap-2">
                {!year.isCurrent && year.status === 'OPEN' && (
                  <form action={setCurrentFiscalYearAction}>
                    <input type="hidden" name="id" value={year.id} />
                    <button type="submit" className="text-xs text-blue-600 hover:underline">Set current</button>
                  </form>
                )}
                {year.status === 'OPEN' && (
                  <form action={closeFiscalYearAction}>
                    <input type="hidden" name="id" value={year.id} />
                    <button type="submit" className="text-xs text-red-600 hover:underline">Close</button>
                  </form>
                )}
                {year.status === 'CLOSED' && (
                  <form action={reopenFiscalYearAction}>
                    <input type="hidden" name="id" value={year.id} />
                    <button type="submit" className="text-xs text-blue-600 hover:underline">Reopen</button>
                  </form>
                )}
              </div>
            </div>
          ))}
          {fiscalYears.length === 0 && <p className="text-sm text-slate-500">No fiscal years defined.</p>}
        </div>
        <form action={createFiscalYearAction} className="grid grid-cols-1 md:grid-cols-4 gap-3 border-t border-slate-100 pt-4">
          <div><label className={labelClass}>Name</label><input name="name" placeholder="FY 2026-27" required className={inputClass} /></div>
          <div><label className={labelClass}>Start Date</label><input name="startDate" type="date" required className={inputClass} /></div>
          <div><label className={labelClass}>End Date</label><input name="endDate" type="date" required className={inputClass} /></div>
          <label className="flex items-center gap-2 text-xs"><input name="setCurrent" type="checkbox" className="h-4 w-4" />Set as current</label>
          <div className="md:col-span-4"><button type="submit" className={buttonClass}>Add Fiscal Year</button></div>
        </form>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Document Numbering</h2>
        <p className="text-xs text-slate-500 mb-4">
          Numbers are allocated atomically inside a database transaction. Prefixes, padding and fiscal-year inclusion are configurable per document type.
        </p>
        <div className="space-y-3">
          {sequences.map((sequence) => (
            <form key={sequence.documentType} action={saveDocumentSequenceAction} className="grid grid-cols-2 md:grid-cols-7 gap-2 rounded-lg border border-slate-200 p-3 text-sm">
              <input type="hidden" name="documentType" value={sequence.documentType} />
              <div className="col-span-2"><div className="font-semibold text-slate-800">{sequence.label}</div><div className="text-[11px] text-slate-500">Next: {sequence.nextNumber}</div></div>
              <input name="prefix" defaultValue={sequence.prefix} placeholder="Prefix" className="rounded border border-slate-300 px-2 py-1 text-xs" />
              <input name="suffix" defaultValue={sequence.suffix} placeholder="Suffix" className="rounded border border-slate-300 px-2 py-1 text-xs" />
              <input name="padding" type="number" min="1" max="12" defaultValue={sequence.padding} className="rounded border border-slate-300 px-2 py-1 text-xs" />
              <input name="startingNumber" type="number" min="1" defaultValue={sequence.startingNumber} className="rounded border border-slate-300 px-2 py-1 text-xs" />
              <select name="resetPolicy" defaultValue={sequence.resetPolicy} className="rounded border border-slate-300 px-2 py-1 text-xs">
                <option value="YEARLY">Yearly</option><option value="NEVER">Never</option>
              </select>
              <label className="flex items-center gap-1 text-[11px]"><input name="includeFiscalYear" type="checkbox" defaultChecked={sequence.includeFiscalYear} className="h-3 w-3" />FY</label>
              <label className="flex items-center gap-1 text-[11px]"><input name="includeDate" type="checkbox" defaultChecked={sequence.includeDate} className="h-3 w-3" />Date</label>
              <button type="submit" className="rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white">Save</button>
            </form>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">White-Label & Module Licensing</h2>
        <form action={updateBrandingAction} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div><label className={labelClass}>Brand Primary Color</label><input type="color" name="primaryColor" defaultValue={organization?.primaryColor ?? '#2563eb'} className="mt-1 h-10 w-24 rounded border border-slate-300 p-1" /></div>
          <div><label className={labelClass}>Logo URL</label><input name="logoUrl" defaultValue={organization?.logoUrl ?? ''} className={inputClass} /></div>
          <div className="md:col-span-2"><button type="submit" className={buttonClass}>Save Branding</button></div>
        </form>
        <div className="divide-y divide-slate-200">
          {Object.values(MODULE_REGISTRY).map((mod) => {
            const isEnabled = tenant.enabledModules.includes(mod.key);
            return (
              <div key={mod.key} className="py-3.5 flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-slate-900 text-sm">{mod.name}</div>
                  <div className="text-xs text-slate-500">{mod.description}</div>
                </div>
                <form action={async () => { 'use server'; await toggleModuleAction(mod.key, !isEnabled); }}>
                  <button type="submit" className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${isEnabled ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
