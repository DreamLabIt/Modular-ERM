import { requireModuleAccess } from '@/core/auth/module-guard';
import { createInvoiceAction } from '@/modules/sales_purchase/actions';
import { listInvoiceFormOptions, listInvoices } from '@/modules/sales_purchase/model';

export default async function SalesInvoicesPage() {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.view');

  const [invoices, [customers, products]] = await Promise.all([
    listInvoices(tenant.organizationId),
    listInvoiceFormOptions(tenant.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sales & Purchase — Sales Invoices</h1>
        <p className="text-sm text-slate-500">Issue customer invoices with automatic stock deduction and income ledger posting.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <form action={createInvoiceAction} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <select name="customerId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select Client</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select name="productId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select Product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({Number(p.sellingPrice)})</option>
            ))}
          </select>
          <input name="quantity" type="number" min={1} defaultValue={1} placeholder="Qty" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="taxPercent" type="number" min={0} defaultValue={0} placeholder="Tax %" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
            Issue Invoice
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Invoice #</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Total ({tenant.organization.currency})</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="px-4 py-3 font-mono text-xs font-semibold">{inv.invoiceNumber}</td>
                <td className="px-4 py-3">{inv.customer.name}</td>
                <td className="px-4 py-3 text-slate-600">{inv.items.map((i) => `${i.description} (x${i.quantity})`).join(', ')}</td>
                <td className="px-4 py-3 font-bold">{Number(inv.totalAmount).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{inv.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
