import { requirePlatformAdmin } from '@/core/auth/platform';
import { listAllInvoices } from '@/core/billing/invoices';

export const dynamic = 'force-dynamic';

export default async function PlatformInvoicesPage() {
  await requirePlatformAdmin();
  const invoices = await listAllInvoices(200);
  const th = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase text-slate-500';
  return (
    <div className="space-y-6 pb-12">
      <h1 className="text-2xl font-bold text-slate-900">Billing Invoices</h1>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead><tr><th className={th}>Number</th><th className={th}>Organization</th><th className={th}>Status</th><th className={th}>Total</th><th className={th}>Paid</th><th className={th}>Due</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="py-2 pr-3 font-mono text-[11px]">{invoice.invoiceNumber}</td>
                <td className="py-2 pr-3">{invoice.organization.name}</td>
                <td className="py-2 pr-3">{invoice.status}</td>
                <td className="py-2 pr-3">{invoice.currency} {invoice.totalAmount.toString()}</td>
                <td className="py-2 pr-3">{invoice.amountPaid.toString()}</td>
                <td className="py-2 pr-3">{invoice.dueDate.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={6} className="p-4 text-slate-500">No billing invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
