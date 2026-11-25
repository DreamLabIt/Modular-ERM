import { requireModuleAccess } from '@/core/auth/module-guard';
import { createProductAction } from '@/modules/inventory/actions';
import { listProducts } from '@/modules/inventory/model';
import { prisma } from '@/core/db/prisma';
import { StockActions } from '../components/stock-actions';

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

export default async function InventoryProductsPage() {
  const tenant = await requireModuleAccess('inventory', 'inventory.view');
  const [products, warehouses, reservations] = await Promise.all([
    listProducts(tenant.organizationId),
    prisma.warehouse.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { name: 'asc' } }),
    prisma.stockReservation.groupBy({
      by: ['productId', 'warehouseId'],
      where: { organizationId: tenant.organizationId, status: 'ACTIVE' },
      _sum: { reservedQuantity: true },
    }),
  ]);

  const reservedMap = new Map(
    reservations.map((reservation) => [
      `${reservation.productId}:${reservation.warehouseId}`,
      reservation._sum.reservedQuantity ?? 0,
    ]),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory — Products & Stock Levels</h1>
          <p className="text-sm text-slate-500">
            Physical, reserved and available stock per warehouse. Every change is recorded in the stock ledger.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <a href="/inventory/stock-ledger" className="rounded-lg border border-slate-300 px-3 py-2">View Stock Ledger</a>
          <a href="/inventory/reservations" className="rounded-lg border border-slate-300 px-3 py-2">View Reservations</a>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Add Product</h2>
        <form action={createProductAction} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input name="sku" placeholder="SKU (DL-105)" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="name" placeholder="Product Name" required className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="costPrice" type="number" placeholder="Cost Price" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="sellingPrice" type="number" placeholder="Selling Price" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <input name="initialStock" type="number" min={0} defaultValue={0} placeholder="Stock" className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="flex-1 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-3">Add</button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Physical</th>
              <th className="px-4 py-3 text-right">Reserved</th>
              <th className="px-4 py-3 text-right">Available</th>
              <th className="px-4 py-3">Warehouse-wise Stock</th>
              <th className="px-4 py-3 text-right">Stock Value</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {products.map((product) => {
              const physical = product.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
              const reserved = product.stocks.reduce(
                (sum, stock) => sum + (reservedMap.get(`${product.id}:${stock.warehouseId}`) ?? 0),
                0,
              );
              const available = physical - reserved;
              const value = product.stocks.reduce((sum, stock) => sum + stock.quantity * Number(product.costPrice), 0);
              return (
                <tr key={product.id}>
                  <td className="px-4 py-3 font-mono text-xs">{product.sku}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {product.name}
                    {physical <= product.reorderLevel && (
                      <div className="text-xs text-red-700">Reorder alert ({product.reorderLevel})</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{formatNumber(physical)}</td>
                  <td className="px-4 py-3 text-right text-amber-700">{formatNumber(reserved)}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-700">{formatNumber(available)}</td>
                  <td className="px-4 py-3 text-xs">
                    {product.stocks.length === 0 ? 'No stock records' : product.stocks.map((stock) => {
                      const stockReserved = reservedMap.get(`${product.id}:${stock.warehouseId}`) ?? 0;
                      return (
                        <div key={stock.id}>
                          {stock.warehouse?.name ?? stock.warehouseId}: {stock.quantity} (avail {stock.quantity - stockReserved})
                        </div>
                      );
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">{numberToCurrency(value)}</td>
                  <td className="px-4 py-3">
                    <StockActions
                      productId={product.id}
                      warehouses={warehouses.map((warehouse) => ({
                        id: warehouse.id,
                        name: warehouse.name,
                        quantity: product.stocks.find((stock) => stock.warehouseId === warehouse.id)?.quantity ?? 0,
                      }))}
                    />
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

function numberToCurrency(value: number) {
  return Number.isFinite(value) ? formatNumber(Math.round(value * 100) / 100) : '—';
}
