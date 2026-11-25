import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission } from '@/lib/permissions';
import { listStockMovements } from '@/modules/inventory/service';
import { prisma } from '@/core/db/prisma';
import { STOCK_MOVEMENT_TYPES } from '@/modules/inventory/types';

type SearchParams = {
  search?: string;
  productId?: string;
  warehouseId?: string;
  movementType?: string;
  from?: string;
  to?: string;
  page?: string;
  sort?: 'date_desc' | 'date_asc' | 'quantity_desc' | 'quantity_asc';
};

function formatDateTime(value: Date) {
  return value.toLocaleString();
}

function isInMovement(type: string) {
  return ['OPENING_STOCK', 'STOCK_IN', 'SALES_RETURN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'PURCHASE_RECEIPT', 'RESERVATION_RELEASED'].includes(type);
}

export default async function StockLedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await requireModuleAccess('inventory');
  if (!hasPermission(tenant.authorization, 'inventory.view_ledger') && !hasPermission(tenant.authorization, 'inventory.manage')) {
    return <div className="text-sm text-slate-500">You do not have permission to view the stock ledger.</div>;
  }

  const [products, warehouses, movementsIn, movementsOut, activeReservations, stockItems] = await Promise.all([
    prisma.product.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { name: 'asc' } }),
    prisma.warehouse.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { name: 'asc' } }),
    prisma.stockMovement.aggregate({ where: { organizationId: tenant.organizationId, quantity: { gt: 0 } }, _sum: { quantity: true } }),
    prisma.stockMovement.aggregate({ where: { organizationId: tenant.organizationId, quantity: { lt: 0 } }, _sum: { quantity: true } }),
    prisma.stockReservation.aggregate({ where: { organizationId: tenant.organizationId, status: 'ACTIVE' }, _sum: { reservedQuantity: true } }),
    prisma.stockItem.findMany({ where: { product: { organizationId: tenant.organizationId } }, include: { product: true } }),
  ]);

  const page = Math.max(1, Number(searchParams.page || 1) || 1);
  const pageSize = 20;
  const fromDate = searchParams.from ? new Date(`${searchParams.from}T00:00:00.000Z`) : undefined;
  const toDate = searchParams.to ? new Date(`${searchParams.to}T23:59:59.999Z`) : undefined;
  const { movements, total } = await listStockMovements(tenant.organizationId, {
    productId: searchParams.productId || undefined,
    warehouseId: searchParams.warehouseId || undefined,
    movementType: (searchParams.movementType || undefined) as Parameters<typeof listStockMovements>[1]['movementType'],
    fromDate,
    toDate,
    search: searchParams.search || undefined,
    sort: searchParams.sort,
    page,
    pageSize,
  });

  const totalStockValue = stockItems.reduce((sum, stock) => sum + stock.quantity * Number(stock.product.costPrice), 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Inventory — Stock Movement Ledger</h1>
        <p className="text-sm text-slate-500">
          Immutable history of every physical stock change, scoped to this organization.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Stock In', value: movementsIn._sum.quantity ?? 0 },
          { label: 'Total Stock Out', value: Math.abs(movementsOut._sum.quantity ?? 0) },
          { label: 'Active Reservations', value: activeReservations._sum.reservedQuantity ?? 0 },
          { label: 'Current Stock Value', value: `${totalStockValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs text-slate-500">{card.label}</p>
            <p className="text-xl font-bold text-slate-900 mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      <form action="/inventory/stock-ledger" method="get" className="flex flex-wrap gap-3">
        <select name="productId" defaultValue={searchParams.productId ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">All products</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
        </select>
        <select name="warehouseId" defaultValue={searchParams.warehouseId ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">All warehouses</option>
          {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
        <select name="movementType" defaultValue={searchParams.movementType ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">All movement types</option>
          {STOCK_MOVEMENT_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
        </select>
        <input name="from" type="date" defaultValue={searchParams.from ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="to" type="date" defaultValue={searchParams.to ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="search" defaultValue={searchParams.search ?? ''} placeholder="Search reference" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select name="sort" defaultValue={searchParams.sort ?? 'date_desc'} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="quantity_desc">Largest quantity first</option>
          <option value="quantity_asc">Smallest quantity first</option>
        </select>
        <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Filter</button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        {movements.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No stock movements found for the selected filters.</div>
        ) : (
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3">Date &amp; Time</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3">Movement Type</th>
                <th className="px-4 py-3 text-right">Qty In</th>
                <th className="px-4 py-3 text-right">Qty Out</th>
                <th className="px-4 py-3 text-right">Previous</th>
                <th className="px-4 py-3 text-right">New</th>
                <th className="px-4 py-3">Created By</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-xs">{formatDateTime(movement.movementDate)}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {movement.referenceNumber ?? movement.referenceId}
                    {movement.invoiceId && (
                      <a href={`/sales-purchase/invoices`} className="block text-blue-700 hover:underline">Invoice</a>
                    )}
                    {movement.goodsReceiptId && (
                      <a href={`/sales-purchase/receipts/${movement.goodsReceiptId}`} className="block text-blue-700 hover:underline">GRN</a>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <a href="/inventory/products" className="text-blue-700 hover:underline">{movement.product.name}</a>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{movement.product.sku}</td>
                  <td className="px-4 py-3">{movement.warehouse.name}</td>
                  <td className="px-4 py-3 text-xs">{movement.movementType.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">{isInMovement(movement.movementType) ? Math.abs(movement.quantity) : '—'}</td>
                  <td className="px-4 py-3 text-right text-red-700">{!isInMovement(movement.movementType) ? Math.abs(movement.quantity) : '—'}</td>
                  <td className="px-4 py-3 text-right">{movement.previousQuantity ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-bold">{movement.newQuantity ?? '—'}</td>
                  <td className="px-4 py-3 text-xs">{movement.createdById ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{movement.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">{total} movement(s) · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && <a href={`/inventory/stock-ledger?page=${page - 1}`} className="rounded border border-slate-300 px-3 py-1">Previous</a>}
            {page < totalPages && <a href={`/inventory/stock-ledger?page=${page + 1}`} className="rounded border border-slate-300 px-3 py-1">Next</a>}
          </div>
        </div>
      )}
    </div>
  );
}
