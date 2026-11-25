import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission } from '@/lib/permissions';
import { listStockReservations } from '@/modules/inventory/service';
import { ExpireReservationsButton, ReservationActions } from '../components/reservation-actions';

type SearchParams = { status?: string; page?: string };

function formatDateTime(value: Date) {
  return value.toLocaleString();
}

export default async function StockReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await requireModuleAccess('inventory', 'inventory.view');
  const canRelease = hasPermission(tenant.authorization, 'inventory.release_reservation') || hasPermission(tenant.authorization, 'inventory.manage');

  const page = Math.max(1, Number(searchParams.page || 1) || 1);
  const status = searchParams.status || 'ALL';
  const { reservations, total } = await listStockReservations(tenant.organizationId, {
    status: status === 'ALL' ? undefined : (status as 'ACTIVE' | 'RELEASED' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED'),
    page,
    pageSize: 20,
  });
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory — Stock Reservations</h1>
          <p className="text-sm text-slate-500">
            Stock committed to pending business operations. Reservations do not change physical stock.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/inventory/products" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Products</a>
          <a href="/inventory/stock-ledger" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Ledger</a>
        </div>
      </div>

      <form className="flex gap-3" action="/inventory/reservations" method="get">
        <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {['ALL', 'ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED'].map((option) => (
            <option key={option} value={option}>{option === 'ALL' ? 'All statuses' : option}</option>
          ))}
        </select>
        <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Filter</button>
      </form>

      <ExpireReservationsButton />

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        {reservations.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No reservations found.</div>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3 text-right">Reserved Qty</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {reservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td className="px-4 py-3">{reservation.product.name} <span className="font-mono text-xs text-slate-500">({reservation.product.sku})</span></td>
                  <td className="px-4 py-3">{reservation.warehouse.name}</td>
                  <td className="px-4 py-3 text-right font-bold">{reservation.reservedQuantity}</td>
                  <td className="px-4 py-3 font-mono text-xs">{reservation.referenceNumber ?? reservation.referenceId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${reservation.status === 'ACTIVE' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                      {reservation.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{reservation.expiresAt ? formatDateTime(reservation.expiresAt) : '—'}</td>
                  <td className="px-4 py-3 text-xs">{formatDateTime(reservation.createdAt)}</td>
                  <td className="px-4 py-3">
                    {canRelease ? (
                      <ReservationActions reservationId={reservation.id} active={reservation.status === 'ACTIVE'} />
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">{total} reservation(s) · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && <a href={`/inventory/reservations?page=${page - 1}`} className="rounded border border-slate-300 px-3 py-1">Previous</a>}
            {page < totalPages && <a href={`/inventory/reservations?page=${page + 1}`} className="rounded border border-slate-300 px-3 py-1">Next</a>}
          </div>
        </div>
      )}
    </div>
  );
}
