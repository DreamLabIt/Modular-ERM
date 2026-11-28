import { assertBillingAccess } from '../actions';
import { listInvoicesForOrganization } from '@/core/billing/invoices';
import { initiatePaymentAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function BillingInvoicesPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { tenant, canManage } = await assertBillingAccess();
  const invoices = await listInvoicesForOrganization(tenant.organizationId);
  const th = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase text-slate-500';
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Invoices</h1><p className="text-sm text-slate-500">Finalized invoices are immutable; corrections require an explicit adjustment.</p></div>
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead><tr><th className={th}>Invoice</th><th className={th}>Period</th><th className={th}>Status</th><th className={th}>Total</th><th className={th}>Paid</th><th className={th}>Due</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="py-2 pr-3 font-mono text-[11px]">{invoice.invoiceNumber}</td>
                <td className="py-2 pr-3">{invoice.billingPeriodStart?.toISOString().slice(0, 10) ?? '—'} → {invoice.billingPeriodEnd?.toISOString().slice(0, 10) ?? '—'}</td>
                <td className="py-2 pr-3">{invoice.status}</td>
                <td className="py-2 pr-3">{invoice.currency} {invoice.totalAmount.toString()}</td>
                <td className="py-2 pr-3">{invoice.amountPaid.toString()}</td>
                <td className="py-2 pr-3">{invoice.dueDate.toISOString().slice(0, 10)}</td>
                <td className="py-2 pr-3 flex gap-2">
                  <a className="font-semibold text-blue-600" href={`/api/billing/invoices/${invoice.id}/pdf`}>PDF</a>
                  {canManage && ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) && (
                    <form action={initiatePaymentAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <select name="provider" className="rounded border px-1 py-0.5 text-[11px]"><option value="MANUAL_BANK">Bank transfer</option><option value="SSLCOMMERZ">SSLCommerz</option></select>
                      <button type="submit" className="ml-1 font-semibold text-emerald-700 hover:underline">Pay</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={7} className="p-4 text-slate-500">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
