import { prisma } from '@/core/db/prisma';
import { assertBillingAccess, updateBillingProfileAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function BillingSettingsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { tenant } = await assertBillingAccess();
  const profile = await prisma.billingProfile.findUnique({ where: { organizationId: tenant.organizationId } });
  const organization = await prisma.organization.findUnique({ where: { id: tenant.organizationId }, select: { email: true, name: true, address: true, taxId: true, phone: true } });
  return (
    <div className="max-w-2xl space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Billing Information</h1><p className="text-sm text-slate-500">Information used on invoices and payment correspondence.</p></div>
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      <form action={updateBillingProfileAction} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
        <div><label className="block text-xs font-semibold">Billing email</label><input name="billingEmail" type="email" required defaultValue={profile?.billingEmail ?? organization?.email ?? ''} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs font-semibold">Company name</label><input name="companyName" defaultValue={profile?.companyName ?? organization?.name ?? ''} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
        <div className="md:col-span-2"><label className="block text-xs font-semibold">Address</label><input name="address" defaultValue={profile?.address ?? organization?.address ?? ''} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs font-semibold">Tax ID</label><input name="taxId" defaultValue={profile?.taxId ?? organization?.taxId ?? ''} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs font-semibold">Phone</label><input name="phone" defaultValue={profile?.phone ?? organization?.phone ?? ''} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></div>
        <div className="md:col-span-2"><button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Save billing information</button></div>
      </form>
    </div>
  );
}
