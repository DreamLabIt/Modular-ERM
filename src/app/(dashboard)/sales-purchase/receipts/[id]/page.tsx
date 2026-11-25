import { requireModuleAccess } from '@/core/auth/module-guard';
import { getGoodsReceiptById } from '@/modules/sales_purchase/model';
import { getStockMovementsForGoodsReceipt } from '@/modules/sales_purchase/service';
import { Prisma } from '@prisma/client';

function formatDate(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    RECORDED: 'bg-emerald-100 text-emerald-700',
    VOID: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {status}
    </span>
  );
}

export default async function GoodsReceiptDetailPage({ params }: { params: { id: string } }) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.grn.view');

  const grn = await getGoodsReceiptById(tenant.organizationId, params.id);
  if (!grn) return <div className="text-sm text-slate-500">Goods Receipt not found.</div>;

  const movements = await getStockMovementsForGoodsReceipt(tenant.organizationId, grn.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 font-mono">{grn.receiptNumber}</h1>
          <p className="text-sm text-slate-500">Goods Receipt · {grn.status}</p>
        </div>
        <a href="/sales-purchase/receipts" className="text-sm text-blue-700 hover:underline">
          Back to Goods Receipts
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Receipt Details</h2>
          <dl className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-slate-500">GRN Number</span><span className="font-mono text-xs font-semibold">{grn.receiptNumber}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Purchase Order</span><span className="font-mono text-xs">{grn.purchaseOrder?.poNumber ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Supplier</span><span>{grn.purchaseOrder?.supplier.name ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Warehouse</span><span>{grn.warehouse.name}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Received Date</span><span className="font-mono text-xs">{formatDate(grn.receivedDate)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Received By</span><span className="font-medium">{grn.receivedBy?.name ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Status</span><StatusBadge status={grn.status} /></div>
          </dl>
          {grn.notes && <p className="text-sm text-slate-600 mt-3">{grn.notes}</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Ordered</th>
              <th className="px-4 py-3 text-right">Previously Received</th>
              <th className="px-4 py-3 text-right">Remaining</th>
              <th className="px-4 py-3 text-right">Received</th>
              <th className="px-4 py-3 text-right">Accepted</th>
              <th className="px-4 py-3 text-right">Rejected</th>
              <th className="px-4 py-3 text-right">Unit Cost</th>
              <th className="px-4 py-3">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {grn.items.map((item) => {
              const remaining = Math.max(0, item.orderedQuantity - item.previouslyReceived - item.acceptedQuantity);
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3">{item.product.name}</td>
                  <td className="px-4 py-3 text-right">{item.orderedQuantity}</td>
                  <td className="px-4 py-3 text-right">{item.previouslyReceived}</td>
                  <td className="px-4 py-3 text-right font-bold">{remaining}</td>
                  <td className="px-4 py-3 text-right font-bold">{item.receivedQuantity}</td>
                  <td className="px-4 py-3 text-right">{item.acceptedQuantity}</td>
                  <td className="px-4 py-3 text-right">{item.rejectedQuantity}</td>
                  <td className="px-4 py-3 text-right font-mono">{Number(item.unitCost).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{item.notes ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 px-5 py-3 border-b border-slate-200">Related Stock Movements</h2>
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Warehouse</th>
              <th className="px-4 py-3">Movement Type</th>
              <th className="px-4 py-3 text-right">Quantity</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3 whitespace-nowrap">Movement Date</th>
              <th className="px-4 py-3">Created By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {movements.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-slate-500" colSpan={7}>No stock movements recorded for this receipt.</td></tr>
            ) : movements.map((movement) => (
              <tr key={movement.id}>
                <td className="px-4 py-3">{movement.product.name}</td>
                <td className="px-4 py-3">{movement.warehouse.name}</td>
                <td className="px-4 py-3">{movement.movementType}</td>
                <td className="px-4 py-3 text-right font-bold">{movement.quantity}</td>
                <td className="px-4 py-3">
                  {movement.referenceType} {movement.referenceId}
                  {movement.purchaseOrderId && (
                    <a href={`/sales-purchase/purchases/${movement.purchaseOrderId}`} className="ml-2 text-blue-700 hover:underline text-xs">PO</a>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(movement.movementDate)}</td>
                <td className="px-4 py-3">{movement.createdById ? 'User ' + movement.createdById.slice(0, 8) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-sm text-slate-600">
        <span>Total Accepted: <strong>{grn.items.reduce((sum, item) => sum + item.acceptedQuantity, 0)}</strong></span>
        <span>Total Rejected: <strong>{grn.items.reduce((sum, item) => sum + item.rejectedQuantity, 0)}</strong></span>
        {grn.items.some((item) => item.unitCost.greaterThan(0)) && (
          <span>
            Accepted Value:{' '}
            <strong>
              {grn.items
                .reduce((sum, item) => sum.plus(new Prisma.Decimal(item.unitCost).mul(item.acceptedQuantity)), new Prisma.Decimal(0))
                .toFixed(2)}
            </strong>
          </span>
        )}
      </div>
    </div>
  );
}
