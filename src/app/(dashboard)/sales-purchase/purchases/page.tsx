import { requireModuleAccess } from '@/core/auth/module-guard';
import { createSupplierAction, createPurchaseOrderAction } from '@/modules/sales_purchase/actions';
import { listPurchaseOrderData } from '@/modules/sales_purchase/model';

export default async function PurchaseOrdersPage() {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.view');

  const [orders, suppliers, products] = await listPurchaseOrderData(tenant.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sales & Purchase — Purchase Orders & Suppliers</h1>
        <p className="text-sm text-slate-500">Procure stock from suppliers with automatic inventory replenishment and expense logging.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Create Purchase Order (PO)</h2>
          <form action={createPurchaseOrderAction} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <select name="supplierId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select name="productId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({Number(p.costPrice)})</option>
              ))}
            </select>
            <input name="quantity" type="number" min={1} defaultValue={10} placeholder="Qty" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-3 py-2">
              Receive PO
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Add Supplier</h2>
          <form action={createSupplierAction} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input name="name" placeholder="Supplier Name" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="email" type="email" placeholder="Email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="phone" placeholder="Phone" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 px-3 py-2">
              Save
            </button>
          </form>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">PO #</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Total Cost ({tenant.organization.currency})</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {orders.map((po) => (
              <tr key={po.id}>
                <td className="px-4 py-3 font-mono text-xs font-semibold">{po.poNumber}</td>
                <td className="px-4 py-3">{po.supplier.name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {po.items.map((i) => `${i.product.name} (x${i.quantity})`).join(', ')}
                </td>
                <td className="px-4 py-3 font-bold">{Number(po.totalAmount).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">{po.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
