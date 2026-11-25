import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission } from '@/lib/permissions';
import {
  getAuditLogs,
  getPurchaseOrderDetails,
} from '@/modules/sales_purchase/model';
import { PoStatusActions } from '../../components/po-status-actions';
import { PoEditForm } from '../../components/po-edit-form';
import { GrnCreateForm } from '../../components/grn-create-form';
import type { PurchaseOrderStatus } from '@/modules/sales_purchase/workflow';
import { Prisma } from '@prisma/client';

type Details = Awaited<ReturnType<typeof getPurchaseOrderDetails>>;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
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

function computeReceiptTotals(po: Details) {
  let receivedQuantity = 0;
  let receivedAmount = 0;

  for (const grn of po?.goodsReceipts ?? []) {
    for (const grnItem of grn.items) {
      receivedQuantity += grnItem.acceptedQuantity;
      receivedAmount += Number(grnItem.unitCost) * grnItem.acceptedQuantity;
    }
  }

  return { receivedQuantity, receivedAmount };
}

export default async function PurchaseOrderDetailPage({ params }: { params: { id: string } }) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.po.view');
  const auth = tenant.authorization;

  const po = await getPurchaseOrderDetails(tenant.organizationId, params.id);
  if (!po) return <div className="text-sm text-slate-500">Purchase Order not found.</div>;

  const { receivedQuantity, receivedAmount } = computeReceiptTotals(po);
  const status = po.status as PurchaseOrderStatus;

  const actionFlags = {
    canEdit: hasPermission(auth, 'sales_purchase.po.edit') || hasPermission(auth, 'sales_purchase.manage'),
    canSubmit: hasPermission(auth, 'sales_purchase.po.submit'),
    canApprove: hasPermission(auth, 'sales_purchase.po.approve'),
    canReject: hasPermission(auth, 'sales_purchase.po.reject'),
    canSend: hasPermission(auth, 'sales_purchase.po.send'),
    canCancel: hasPermission(auth, 'sales_purchase.po.cancel'),
    canCreateGrn: hasPermission(auth, 'sales_purchase.grn.create') || hasPermission(auth, 'sales_purchase.manage'),
  };

  const totalOrdered = po.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
  const totalReceived = receivedQuantity;

  const grnLines = po.items.map((item) => ({
    purchaseOrderItemId: item.id,
    productId: item.productId,
    productName: item.product.name,
    unitCost: new Prisma.Decimal(item.unitCost).toFixed(2),
    orderedQuantity: item.orderedQuantity,
    previouslyReceived: item.previouslyReceived,
    remaining: Math.max(0, item.orderedQuantity - item.previouslyReceived),
    receivedQuantity: '',
    acceptedQuantity: '',
    rejectedQuantity: '',
  }));

  const auditLogs = await getAuditLogs(tenant.organizationId, 'PURCHASE_ORDER', po.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 font-mono">{po.poNumber}</h1>
            <StatusBadge status={po.status} />
            {po.legacyReceivedAt && (
              <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                Legacy — no GRN history
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Supplier: {po.supplier.name}{po.supplier.email ? ` · ${po.supplier.email}` : ''}
          </p>
        </div>
        <a href="/sales-purchase/purchases" className="text-sm text-blue-700 hover:underline">
          Back to Purchase Orders
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Details</h2>
          <dl className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-slate-500">Status</span><span className="font-medium">{po.status.replaceAll('_', ' ')}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Order Date</span><span className="font-mono text-xs">{formatDate(po.createdAt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Expected Delivery</span><span className="font-mono text-xs">{formatDate(po.expectedDate)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Total</span><span className="font-bold">{Number(po.totalAmount).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Received Qty</span><span className="font-bold">{totalReceived}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Received Amount</span><span className="font-bold">{receivedAmount.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Approved By</span><span className="font-medium">{po.approvedBy?.name ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Created By</span><span className="font-medium">{po.createdBy?.name ?? '—'}</span></div>
            {po.rejectionReason && <div className="flex justify-between"><span className="text-slate-500">Rejection Reason</span><span className="text-red-700">{po.rejectionReason}</span></div>}
            {po.cancellationReason && <div className="flex justify-between"><span className="text-slate-500">Cancellation Reason</span><span className="text-red-700">{po.cancellationReason}</span></div>}
          </dl>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm md:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Supplier & Warehouse</h2>
          <dl className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-slate-500">Supplier</span><span>{po.supplier.name}</span></div>
            {po.supplier.phone && <div className="flex justify-between"><span className="text-slate-500">Phone</span><span>{po.supplier.phone}</span></div>}
            {po.supplier.address && <div className="flex justify-between"><span className="text-slate-500">Address</span><span>{po.supplier.address}</span></div>}
            <div className="flex justify-between"><span className="text-slate-500">Warehouse</span><span>{po.warehouse.name}</span></div>
            {po.warehouse.location && <div className="flex justify-between"><span className="text-slate-500">Warehouse Location</span><span>{po.warehouse.location}</span></div>}
          </dl>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Ordered</th>
              <th className="px-4 py-3 text-right">Previously Received</th>
              <th className="px-4 py-3 text-right">Remaining</th>
              <th className="px-4 py-3 text-right">Unit Cost</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {po.items.map((item) => {
              const remaining = Math.max(0, item.orderedQuantity - item.previouslyReceived);
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3">{item.product.name}</td>
                  <td className="px-4 py-3 text-right">{item.orderedQuantity}</td>
                  <td className="px-4 py-3 text-right">{item.previouslyReceived}</td>
                  <td className="px-4 py-3 text-right font-bold">{remaining}</td>
                  <td className="px-4 py-3 text-right font-mono">{Number(item.unitCost).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-bold">{Number(item.total).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{item.notes ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 text-right font-bold flex gap-6">
          <span>Ordered Total: {Number(po.totalAmount).toLocaleString()}</span>
          <span>Received: {totalReceived}</span>
          <span>Received Amount: {receivedAmount.toLocaleString()}</span>
          <span>Ordered Total Quantity: {totalOrdered}</span>
        </div>
      </div>

      {status === 'DRAFT' && actionFlags.canEdit && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Edit Draft Purchase Order</h2>
          <PoEditForm
            purchaseOrderId={po.id}
            supplierOptions={po.supplier ? [po.supplier] : []}
            productOptions={[]}
            warehouseOptions={po.warehouse ? [po.warehouse] : []}
            initialSupplierId={po.supplierId}
            initialWarehouseId={po.warehouseId}
            initialExpectedDate={po.expectedDate ? po.expectedDate.toISOString().slice(0, 10) : ''}
            initialItems={po.items.map((item) => ({ productId: item.productId, quantity: item.orderedQuantity, notes: item.notes ?? null }))}
          />
        </div>
      )}

      {actionFlags.canCreateGrn && status !== 'RECEIVED' && status !== 'REJECTED' && status !== 'CANCELLED' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Record Goods Receipt (GRN)</h2>
          <GrnCreateForm purchaseOrderId={po.id} lines={grnLines} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Actions</h2>
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

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Approval History</h2>
          {po.approvals.length === 0 ? (
            <p className="text-xs text-slate-500">No approval history yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {po.approvals.map((approval) => (
                <li key={approval.id} className="rounded border border-slate-200 p-2">
                  <div><strong>{approval.action}</strong> · {formatDate(approval.createdAt)}</div>
                  {approval.approvedById && <div className="text-slate-500">By {approval.approvedById}</div>}
                  {approval.rejectedReason && <div className="text-red-700">Reason: {approval.rejectedReason}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Receipt History</h2>
        {po.goodsReceipts.length === 0 ? (
          <p className="text-xs text-slate-500">No Goods Receipts recorded for this Purchase Order.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {po.goodsReceipts.map((grn) => (
              <li key={grn.id} className="rounded border border-slate-200 p-2">
                <div><strong>{grn.receiptNumber}</strong> · status: {grn.status} · received {formatDate(grn.receivedDate)}</div>
                <div className="text-slate-500">
                  {grn.items.map((item) => `${item.product.name} (accepted ${item.acceptedQuantity}, rejected ${item.rejectedQuantity})`).join(' · ')}
                </div>
                <a href={`/sales-purchase/receipts/${grn.id}`} className="text-blue-700 hover:underline">
                  View GRN details
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Activity Timeline</h2>
        {auditLogs.length === 0 ? (
          <p className="text-xs text-slate-500">No activity recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {auditLogs.map((log) => (
              <li key={log.id} className="rounded border border-slate-200 p-2">
                <div><strong>{log.action}</strong> · {formatDate(log.createdAt)}</div>
                <div className="text-slate-500">By {log.actor?.name ?? log.actorUserId}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
