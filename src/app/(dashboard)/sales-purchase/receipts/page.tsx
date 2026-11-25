import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission } from '@/lib/permissions';
import { getGoodsReceipts } from '@/modules/sales_purchase/model';

type SearchParams = { search?: string; status?: string; from?: string; to?: string; page?: string };

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

export default async function GoodsReceiptsPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.grn.view');

  const receipts = await getGoodsReceipts(tenant.organizationId);

  const search = (searchParams.search ?? '').trim();
  const statusFilter = searchParams.status || 'ALL';
  const from = searchParams.from || '';
  const to = searchParams.to || '';
  const page = Math.max(1, Number(searchParams.page || 1) || 1);
  const pageSize = 10;

  const filtered = receipts.filter((grn) => {
    const searchText = search.toLowerCase();
    const matchesSearch = !searchText ||
      grn.receiptNumber.toLowerCase().includes(searchText) ||
      grn.purchaseOrder?.poNumber.toLowerCase().includes(searchText) ||
      grn.purchaseOrder?.supplier.name.toLowerCase().includes(searchText);
    const matchesStatus = statusFilter === 'ALL' || grn.status === statusFilter;
    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;
    const receivedDate = new Date(grn.receivedDate);
    return (
      (!fromDate || receivedDate.getTime() >= fromDate.getTime()) &&
      (!toDate || receivedDate.getTime() <= toDate.getTime()) &&
      matchesSearch &&
      matchesStatus
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageReceipts = filtered.slice((page - 1) * pageSize, page * pageSize);

  const canCreateGrn = hasPermission(tenant.authorization, 'sales_purchase.grn.create') ||
    hasPermission(tenant.authorization, 'sales_purchase.manage');

  const totalAccepted = filtered.reduce((sum, grn) => sum + grn.items.reduce((itemSum, item) => itemSum + item.acceptedQuantity, 0), 0);
  const totalRejected = filtered.reduce((sum, grn) => sum + grn.items.reduce((itemSum, item) => itemSum + item.rejectedQuantity, 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Goods Received Notes (GRN)</h1>
          <p className="text-sm text-slate-500">
            Goods only move into stock when a valid GRN is recorded against an approved Purchase Order.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-slate-500">Accepted</span><strong className="ml-2">{totalAccepted}</strong>
          </div>
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-slate-500">Rejected</span><strong className="ml-2">{totalRejected}</strong>
          </div>
        </div>
      </div>

      <form className="flex flex-wrap gap-3" action="/sales-purchase/receipts" method="get">
        <input name="search" defaultValue={search} placeholder="Search GRN or PO #" className="rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-56" />
        <select name="status" defaultValue={statusFilter} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="ALL">All statuses</option>
          <option value="RECORDED">Recorded</option>
          <option value="VOID">Void</option>
        </select>
        <input name="from" type="date" defaultValue={from} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="to" type="date" defaultValue={to} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Filter</button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        {pageReceipts.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No goods receipts match the current filters.</div>
        ) : (
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-mono">GRN #</th>
                <th className="px-4 py-3">Purchase Order</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3 whitespace-nowrap">Received Date</th>
                <th className="px-4 py-3">Received By</th>
                <th className="px-4 py-3 text-right">Accepted</th>
                <th className="px-4 py-3 text-right">Rejected</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pageReceipts.map((grn) => {
                const accepted = grn.items.reduce((sum, item) => sum + item.acceptedQuantity, 0);
                const rejected = grn.items.reduce((sum, item) => sum + item.rejectedQuantity, 0);
                return (
                  <tr key={grn.id}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{grn.receiptNumber}</td>
                    <td className="px-4 py-3 font-mono text-xs">{grn.purchaseOrder?.poNumber ?? '—'}</td>
                    <td className="px-4 py-3">{grn.purchaseOrder?.supplier.name ?? '—'}</td>
                    <td className="px-4 py-3">{grn.warehouse.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(grn.receivedDate)}</td>
                    <td className="px-4 py-3">{grn.receivedBy?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-bold">{accepted}</td>
                    <td className="px-4 py-3 text-right">{rejected}</td>
                    <td className="px-4 py-3"><StatusBadge status={grn.status} /></td>
                    <td className="px-4 py-3">
                      <a href={`/sales-purchase/receipts/${grn.id}`} className="text-blue-700 hover:underline text-xs">View</a>
                      {canCreateGrn && grn.purchaseOrder && (
                        <a href={`/sales-purchase/purchases/${grn.purchaseOrder.id}`} className="text-blue-700 hover:underline text-xs ml-3">
                          PO
                        </a>
                      )}
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
            {filtered.length} receipt(s) · page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a href={`/sales-purchase/receipts?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`} className="rounded border border-slate-300 px-3 py-1">
                Previous
              </a>
            )}
            {page < totalPages && (
              <a href={`/sales-purchase/receipts?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`} className="rounded border border-slate-300 px-3 py-1">
                Next
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
