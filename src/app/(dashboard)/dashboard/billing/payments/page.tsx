import { assertBillingAccess } from '../actions';
import { listPaymentsForOrganization } from '@/core/billing/payments/service';

export const dynamic = 'force-dynamic';

export default async function BillingPaymentsPage() {
  const { tenant } = await assertBillingAccess();
  const payments = await listPaymentsForOrganization(tenant.organizationId);
  const th = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase text-slate-500';
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Payment History</h1><p className="text-sm text-slate-500">Payments are never considered successful until verified or explicitly approved.</p></div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead><tr><th className={th}>Date</th><th className={th}>Invoice</th><th className={th}>Provider</th><th className={th}>Amount</th><th className={th}>Status</th><th className={th}>Reference</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td className="py-2 pr-3">{payment.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="py-2 pr-3">{payment.invoice.invoiceNumber}</td>
                <td className="py-2 pr-3">{payment.provider}</td>
                <td className="py-2 pr-3">{payment.currency} {payment.amount.toString()}</td>
                <td className="py-2 pr-3">{payment.status}</td>
                <td className="py-2 pr-3 font-mono text-[10px]">{payment.providerReference?.slice(0, 24) ?? '—'}</td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={6} className="p-4 text-slate-500">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
