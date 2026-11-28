import { requirePlatformAdmin } from '@/core/auth/platform';
import { prisma } from '@/core/db/prisma';

export const dynamic = 'force-dynamic';

export default async function PlatformUsagePage() {
  await requirePlatformAdmin();
  const [usage, organizations] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ['category'],
      _sum: { quantity: true },
    }),
    prisma.organizationSubscription.findMany({ include: { organization: true, plan: true }, take: 100 }),
  ]);
  return (
    <div className="space-y-8 pb-12">
      <h1 className="text-2xl font-bold text-slate-900">Usage Metering</h1>
      <section className="grid gap-4 md:grid-cols-3">
        {usage.map((row) => (
          <div key={row.category} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase text-slate-500">{row.category}</div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{row._sum.quantity ?? 0}</div>
          </div>
        ))}
        {usage.length === 0 && <p className="text-sm text-slate-500">No metered usage recorded yet.</p>}
      </section>
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead><tr><th className="py-2 pr-3 text-left text-[11px] uppercase text-slate-500">Organization</th><th className="py-2 pr-3 text-left text-[11px] uppercase text-slate-500">Plan</th><th className="py-2 pr-3 text-left text-[11px] uppercase text-slate-500">Limits</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {organizations.map((sub) => (
              <tr key={sub.id}>
                <td className="py-2 pr-3">{sub.organization.name}</td>
                <td className="py-2 pr-3">{sub.plan.name}</td>
                <td className="py-2 pr-3">Employees {sub.plan.maxEmployees ?? '∞'} · Users {sub.plan.maxUsers ?? '∞'} · Projects {sub.plan.maxProjects ?? '∞'} · Storage {sub.plan.maxStorageMb ?? '∞'} MB · API {sub.plan.maxApiCalls ?? '∞'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
