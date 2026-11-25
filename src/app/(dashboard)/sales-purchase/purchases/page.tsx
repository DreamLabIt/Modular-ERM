import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission } from '@/lib/permissions';
import { listPurchaseOrderData } from '@/modules/sales_purchase/model';
import { PoCreateForm } from '../components/po-create-form';
import { PoStatusActions } from '../components/po-status-actions';
import type { PurchaseOrderStatus } from '@/modules/sales_purchase/workflow';

type SearchParams = { search?: string; status?: string; from?: string; to?: string; page?: string };

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SENT', label: 'Sent to Supplier' },
  { value: 'PARTIALLY_RECEIVED', label: 'Partially Received' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function formatDate(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

type PurchaseOrderWithData = Awaited<ReturnType<typeof listPurchaseOrderData>>[0][number];

interface PoReceiptTotals {
  receivedQuantity: number;
  receivedAmount: number;
  remainingQuantity: number;
}

function getPoReceiptTotals(po: PurchaseOrderWithData): PoReceiptTotals {
  const totals: PoReceiptTotals = { receivedQuantity: 0, receivedAmount: 0, remainingQuantity: 0 };
  for (const grn of po.goodsReceipts) {
    for (const item of grn.items) {
      totals.receivedQuantity += item.acceptedQuantity;
      totals.receivedAmount += Number(item.unitCost) * item.acceptedQuantity;
    }
  }
  for (const item of po.items) {
    totals.remainingQuantity += Math.max(0, item.orderedQuantity - item.previouslyReceived);
  }
  return totals;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
    APPROVED: 'bg-blue-100 text-blue-700',
    SENT: 'bg-cyan-100 text-cyan-700',
    PARTIALLY_RECEIVED: 'bg-emerald-100 text-emerald-700',
    RECEIVED: 'bg-emerald-100 text-emerald-700',
    REJECTED: 'bg-red-100 text-red-700',
    CANCELLED: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status] ?? styles.DRAFT}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export default async function PurchasesPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.po.view');
  const auth = tenant.authorization;

  const [orders, suppliers, products, warehouses] = await listPurchaseOrderData(tenant.organizationId);

  const search = (searchParams.search ?? '').trim();
  const statusFilter = searchParams.status || 'ALL';
  const from = searchParams.from || '';
  const to = searchParams.to || '';
  const page = Math.max(1, Number(searchParams.page || 1) || 1);
  const pageSize = 10;

  const filtered = orders.filter((po) => {
    const searchText = search.toLowerCase();
    const matchesSearch = !searchText ||
      po.poNumber.toLowerCase().includes(searchText) ||
      po.supplier.name.toLowerCase().includes(searchText);
    const matchesStatus = statusFilter === 'ALL' || po.status === statusFilter;
    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;
    const referenceDate = po.expectedDate ?? po.createdAt;
    const matchesDates =
      (fromDate ? referenceDate.getTime() >= fromDate.getTime() : true) &&
      (toDate ? referenceDate.getTime() <= toDate.getTime() : true);
    return matchesSearch && matchesStatus && matchesDates;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageOrders = filtered.slice((page - 1) * pageSize, page * pageSize);

  const canCreate = hasPermission(auth, 'sales_purchase.po.create') || hasPermission(auth, 'sales_purchase.manage');

  const actionFlags = {
    canEdit: hasPermission(auth, 'sales_purchase.po.edit') || hasPermission(auth, 'sales_purchase.manage'),
    canSubmit: hasPermission(auth, 'sales_purchase.po.submit'),
    canApprove: hasPermission(auth, 'sales_purchase.po.approve'),
    canReject: hasPermission(auth, 'sales_purchase.po.reject'),
    canSend: hasPermission(auth, 'sales_purchase.po.send'),
    canCancel: hasPermission(auth, 'sales_purchase.po.cancel'),
    canCreateGrn: hasPermission(auth, 'sales_purchase.grn.create') || hasPermission(auth, 'sales_purchase.manage'),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sales & Purchase — Purchase Orders</h1>
        <p className="text-sm text-slate-500">
          Create purchase orders, send them for approval, and record goods received notes (GRNs).
        </p>
      </div>

      {canCreate && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Create Purchase Order (PO)</h2>
          <PoCreateForm suppliers={suppliers} products={products} warehouses={warehouses} />
        </div>
      )}

      <form className="flex flex-wrap gap-3" action="/sales-purchase/purchases" method="get">
        <input name="search" defaultValue={search} placeholder="Search PO or supplier" className="rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-56" />
        <select name="status" defaultValue={statusFilter} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <input name="from" type="date" defaultValue={from} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" title="Order/expected date from" />
        <input name="to" type="date" defaultValue={to} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" title="Order/expected date to" />
        <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Filter</button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        {pageOrders.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No purchase orders match the current filters.</div>
        ) : (
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3">PO #</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3 whitespace-nowrap">Order Date</th>
                <th className="px-4 py-3 whitespace-nowrap">Expected Delivery</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Received Qty</th>
                <th className="px-4 py-3 text-right">Received Amount</th>
                <th className="px-4 py-3 text-right">Remaining</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created By / At</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pageOrders.map((po) => {
                const totals = getPoReceiptTotals(po);
                const status = po.status as PurchaseOrderStatus;
                return (
                  <tr key={po.id} className="align-top">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{po.poNumber}</td>
                    <td className="px-4 py-3">{po.supplier.name}</td>
                    <td className="px-4 py-3">{po.warehouse?.name ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(po.createdAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(po.expectedDate)}</td>
                    <td className="px-4 py-3 text-right font-bold">{Number(po.totalAmount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{totals.receivedQuantity}</td>
                    <td className="px-4 py-3 text-right">{totals.receivedQuantity > 0 ? Number(totals.receivedAmount).toLocaleString() : '0'}</td>
                    <td className="px-4 py-3 text-right">{totals.remainingQuantity}</td>
                    <td className="px-4 py-3"><StatusBadge status={po.status} /></td>
                    <td className="px-4 py-3">
                      {po.createdBy ? `${po.createdBy.name}` : '—'}
                      <div className="text-xs text-slate-500">{formatDate(po.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2 min-w-44">
                        <a href={`/sales-purchase/purchases/${po.id}`} className="text-blue-700 text-xs hover:underline">
                          View
                        </a>
                        {actionFlags.canCreateGrn && (
                          <a href={`/sales-purchase/receipts?purchaseOrderId=${po.id}`} className="text-emerald-700 text-xs hover:underline">
                            GRN
                          </a>
                        )}
                        <PoStatusActions
                          purchaseOrderId={po.id}
                          status={status}
                          canSubmit={actionFlags.canSubmit}
                          canApprove={actionFlags.canApprove}
                          canReject={actionFlags.canReject}
                          canSend={actionFlags.canSend}
                          canCancel={actionFlags.canCancel}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            {filtered.length} purchase order(s) · page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`/sales-purchase/purchases?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ''}${statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''}`}
                className="rounded border border-slate-300 px-3 py-1"
              >
                Previous
              </a>
            )}
            {page < totalPages && (
              <a
                href={`/sales-purchase/purchases?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ''}${statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''}`}
                className="rounded border border-slate-300 px-3 py-1"
              >
                Next
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
