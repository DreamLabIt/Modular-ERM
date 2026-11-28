import Link from 'next/link';
import { assertBillingAccess } from './actions';

const links = [
  { href: '/dashboard/billing', label: 'Overview' },
  { href: '/dashboard/billing/plans', label: 'Plans' },
  { href: '/dashboard/billing/subscription', label: 'Subscription' },
  { href: '/dashboard/billing/invoices', label: 'Invoices' },
  { href: '/dashboard/billing/payments', label: 'Payments' },
  { href: '/dashboard/billing/usage', label: 'Usage' },
  { href: '/dashboard/billing/settings', label: 'Billing details' },
];

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  await assertBillingAccess();
  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            {link.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
