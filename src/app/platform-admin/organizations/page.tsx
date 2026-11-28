import Link from 'next/link';
import { requirePlatformAdmin } from '@/core/auth/platform';
import { prisma } from '@/core/db/prisma';

export const dynamic = 'force-dynamic';

export default async function PlatformOrganizationsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePlatformAdmin();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const search = typeof searchParams.search === 'string' ? searchParams.search : '';
  const where = search ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { slug: { contains: search, mode: 'insensitive' as const } }] } : {};
  const [organizations, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * 20,
      take: 20,
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { users: true, employees: true } },
      },
    }),
    prisma.organization.count({ where }),
  ]);
  const th = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase text-slate-500';
  return (
    <div className="space-y-6 pb-12">
      <h1 className="text-2xl font-bold text-slate-900">Organizations</h1>
      <form className="flex gap-2">
        <input name="search" defaultValue={search} placeholder="Search by name or slug" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Search</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead><tr><th className={th}>Organization</th><th className={th}>Plan</th><th className={th}>Status</th><th className={th}>Users</th><th className={th}>Employees</th><th className={th}>Created</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {organizations.map((org) => (
              <tr key={org.id}>
                <td className="py-2 pr-3 font-semibold">{org.name}<div className="text-[10px] text-slate-500">{org.slug}</div></td>
                <td className="py-2 pr-3">{org.subscription?.plan.name ?? '—'}</td>
                <td className="py-2 pr-3">{org.subscription?.status ?? 'NO SUBSCRIPTION'}</td>
                <td className="py-2 pr-3">{org._count.users}</td>
                <td className="py-2 pr-3">{org._count.employees}</td>
                <td className="py-2 pr-3">{org.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">Page {page} of {Math.max(1, Math.ceil(total / 20))} · {total} organizations</p>
      <Link href="/platform-admin/subscriptions" className="text-xs font-semibold text-blue-600">Manage subscriptions →</Link>
    </div>
  );
}
