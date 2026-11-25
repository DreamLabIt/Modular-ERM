import { requireModuleAccess } from '@/core/auth/module-guard';
import { createProductAction, adjustStockAction } from '@/modules/inventory/actions';
import { listProducts } from '@/modules/inventory/model';

export default async function InventoryProductsPage() {
  const tenant = await requireModuleAccess('inventory', 'inventory.view');
  const products = await listProducts(tenant.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Inventory — Products & Stock Levels</h1>
        <p className="text-sm text-slate-500">Manage product catalog, pricing, and real-time warehouse stock.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <form action={createProductAction} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input name="sku" placeholder="SKU (DL-105)" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="name" placeholder="Product Name" required className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="costPrice" type="number" placeholder="Cost Price" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="sellingPrice" type="number" placeholder="Selling Price" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <input name="initialStock" type="number" defaultValue={10} placeholder="Stock" className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="flex-1 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-3">Add</button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">Selling Price</th>
              <th className="px-4 py-3">Current Stock</th>
              <th className="px-4 py-3 text-right">Adjust</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {products.map((p) => {
              const total = p.stocks.reduce((a, b) => a + b.quantity, 0);
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-4 py-3">{Number(p.costPrice).toLocaleString()}</td>
                  <td className="px-4 py-3">{Number(p.sellingPrice).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${total <= p.reorderLevel ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {total} {p.unit}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <form action={async () => { 'use server'; await adjustStockAction(p.id, 5); }} className="inline">
                      <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs font-semibold">+5</button>
                    </form>
                    <form action={async () => { 'use server'; await adjustStockAction(p.id, -1); }} className="inline">
                      <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs font-semibold">-1</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
