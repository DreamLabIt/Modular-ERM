import { requireModuleAccess } from '@/core/auth/module-guard';
import { createInvoiceAction } from '@/modules/sales/actions';
import { listInvoiceFormOptions, listInvoices } from '@/modules/sales/model';

export default async function SalesInvoicesPage() {
  const tenant = await requireModuleAccess('sales', 'sales.view');

  const [invoices, [customers, products]] = await Promise.all([
    listInvoices(tenant.organizationId),
    listInvoiceFormOptions(tenant.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sales & Billing Invoices</h1>
        <p className="text-sm text-slate-500">
          Create draft sales invoices. Stock is deducted only when an invoice is issued through the Sales &amp; Purchase workflow.
        </p>
      </div>

      {/* Quick Create Invoice */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Generate New Invoice</h2>
        <form action={createInvoiceAction} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <select name="customerId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select Customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select name="productId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select Product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({Number(p.sellingPrice)})
              </option>
            ))}
          </select>
          <input
            name="quantity"
            type="number"
            min={1}
            defaultValue={1}
            placeholder="Quantity"
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="taxPercent"
            type="number"
            min={0}
            defaultValue={0}
            placeholder="Tax %"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 px-4 py-2">
            Create Draft
          </button>
        </form>
      </div>

      {/* Invoices List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-4 py-3">Invoice #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Total ({tenant.organization.currency})</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                  {inv.invoiceNumber}
                </td>
                <td className="px-4 py-3">{inv.customer.name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {inv.items.map((i) => `${i.description} (x${i.quantity})`).join(', ')}
                </td>
                <td className="px-4 py-3 font-semibold">
                  {Number(inv.totalAmount).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-700'
                    : inv.status === 'CANCELLED' ? 'bg-red-100 text-red-700'
                    : inv.status === 'OVERDUE' ? 'bg-orange-100 text-orange-700'
                    : 'bg-slate-100 text-slate-700'
                  }`}>
                    {inv.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
