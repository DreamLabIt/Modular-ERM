import Link from 'next/link';
import { getOptionalPlatformAdmin } from '@/core/auth/platform';
import { signOut } from '@/core/auth/auth';

const links = [
  { href: '/platform-admin', label: 'Overview' },
  { href: '/platform-admin/organizations', label: 'Organizations' },
  { href: '/platform-admin/plans', label: 'Plans' },
  { href: '/platform-admin/subscriptions', label: 'Subscriptions' },
  { href: '/platform-admin/invoices', label: 'Invoices' },
  { href: '/platform-admin/payments', label: 'Payments' },
  { href: '/platform-admin/gateways', label: 'Gateways' },
  { href: '/platform-admin/usage', label: 'Usage' },
  { href: '/platform-admin/analytics', label: 'Analytics' },
  { href: '/platform-admin/settings', label: 'Settings' },
];

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getOptionalPlatformAdmin();
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950 text-slate-200 md:flex">
        <div className="border-b border-slate-800 p-5">
          <div className="text-sm font-bold text-white">Platform Admin</div>
          <div className="mt-1 text-[11px] text-slate-400">SaaS subscriptions & billing</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="block rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-slate-900 hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-4">
          {admin ? (
            <>
              <div className="truncate text-xs font-semibold text-white">{admin.name}</div>
              <div className="truncate text-[11px] text-slate-400">{admin.email}</div>
              <form action={async () => { 'use server'; await signOut({ redirectTo: '/platform-admin/login' }); }}>
                <button type="submit" className="mt-2 text-[11px] font-semibold text-red-400 hover:underline">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/platform-admin/login" className="text-xs font-semibold text-blue-400">Sign in</Link>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-5 sm:p-8">{children}</main>
    </div>
  );
}
