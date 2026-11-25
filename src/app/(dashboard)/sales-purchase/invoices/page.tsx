import { randomUUID } from 'crypto';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission } from '@/lib/permissions';
import {
  cancelInvoiceAction,
  createInvoiceAction,
  deleteDraftInvoiceAction,
  issueInvoiceAction,
  recordInvoicePaymentAction,
  updateDraftInvoiceAction,
} from '@/modules/sales_purchase/actions';
import { listInvoiceFormOptions, listInvoices } from '@/modules/sales_purchase/model';

type SearchParams = { search?: string; status?: string };

export default async function SalesInvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await requireModuleAccess('sales_purchase');
  const canView = hasPermission(tenant.authorization, 'sales_purchase.invoice.view') ||
    hasPermission(tenant.authorization, 'sales_purchase.view');
  if (!canView) return null;

  const [invoices, [customers, products]] = await Promise.all([
    listInvoices(tenant.organizationId),
    listInvoiceFormOptions(tenant.organizationId),
  ]);
  const search = (searchParams.search ?? '').trim().toLowerCase();
  const statusFilter = searchParams.status ?? 'ALL';
  const filtered = invoices.filter((invoice) => {
    const matchesSearch = !search ||
      invoice.invoiceNumber.toLowerCase().includes(search) ||
      invoice.customer.name.toLowerCase().includes(search);
    const matchesStatus = statusFilter === 'ALL' || invoice.effectiveStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const canCreate = hasPermission(tenant.authorization, 'sales_purchase.invoice.create') ||
    hasPermission(tenant.authorization, 'sales_purchase.manage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sales Invoices</h1>
        <p className="text-sm text-slate-500">
          Draft, issue, collect, and reconcile customer invoices.
        </p>
      </div>

      {canCreate && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Create Draft</h2>
          <form action={createInvoiceAction} className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <select name="customerId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
            <select name="productId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name} ({Number(product.sellingPrice).toFixed(2)})</option>
              ))}
            </select>
            <input name="quantity" type="number" min={1} step={1} defaultValue={1} required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="taxPercent" type="number" min={0} max={100} step="0.01" defaultValue={0} required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="dueDate" type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
              Create Draft
            </button>
          </form>
        </div>
      )}

      <form className="flex flex-wrap gap-3" action="/sales-purchase/invoices" method="get">
        <input name="search" defaultValue={searchParams.search ?? ''} placeholder="Search invoice or customer" className="rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-64" />
        <select name="status" defaultValue={statusFilter} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="ALL">All statuses</option>
          {['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].map((status) => (
            <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
          ))}
        </select>
        <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Filter</button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No invoices match the current filters.</div>
        ) : (
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Invoice Date</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((invoice) => {
                const canEdit = invoice.status === 'DRAFT' &&
                  (hasPermission(tenant.authorization, 'sales_purchase.invoice.edit') ||
                    hasPermission(tenant.authorization, 'sales_purchase.manage'));
                const canIssue = invoice.status === 'DRAFT' &&
                  (hasPermission(tenant.authorization, 'sales_purchase.invoice.issue') ||
                    hasPermission(tenant.authorization, 'sales_purchase.manage'));
                const canPay = ['SENT', 'PARTIALLY_PAID'].includes(invoice.status) &&
                  invoice.outstandingBalance.greaterThan(0) &&
                  (hasPermission(tenant.authorization, 'sales_purchase.invoice.payment.record') ||
                    hasPermission(tenant.authorization, 'sales_purchase.manage'));
                const canCancel = ['DRAFT', 'SENT', 'PARTIALLY_PAID'].includes(invoice.status) &&
                  invoice.status !== 'PAID' &&
                  (hasPermission(tenant.authorization, 'sales_purchase.invoice.cancel') ||
                    hasPermission(tenant.authorization, 'sales_purchase.manage'));
                const canViewPayments = hasPermission(tenant.authorization, 'sales_purchase.invoice.payment.view') ||
                  hasPermission(tenant.authorization, 'sales_purchase.manage') ||
                  hasPermission(tenant.authorization, 'sales_purchase.view');

                return (
                  <tr key={invoice.id} className="align-top">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{invoice.invoiceNumber}</td>
                    <td className="px-4 py-3">{invoice.customer.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{(invoice.issueDate ?? invoice.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{invoice.dueDate?.toLocaleDateString() ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-bold">{Number(invoice.totalAmount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{Number(invoice.totalPaid).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{Number(invoice.outstandingBalance).toFixed(2)}</td>
                    <td className="px-4 py-3"><StatusBadge status={invoice.effectiveStatus} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2 min-w-44">
                        {canEdit && (
                          <details>
                            <summary className="cursor-pointer text-blue-700">Edit Draft</summary>
                            <form action={updateDraftInvoiceAction} className="mt-2 grid gap-2 min-w-64">
                              <input type="hidden" name="invoiceId" value={invoice.id} />
                              <select name="customerId" defaultValue={invoice.customerId} required className="rounded border px-2 py-1">
                                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                              </select>
                              <select name="productId" defaultValue={invoice.items[0]?.productId} required className="rounded border px-2 py-1">
                                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                              </select>
                              <input name="quantity" type="number" min={1} defaultValue={invoice.items[0]?.quantity ?? 1} required className="rounded border px-2 py-1" />
                              <input
                                name="taxPercent"
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                defaultValue={Number(invoice.subtotal) > 0 ? (Number(invoice.taxAmount) / Number(invoice.subtotal) * 100).toFixed(2) : '0'}
                                className="rounded border px-2 py-1"
                              />
                              <input name="dueDate" type="date" defaultValue={invoice.dueDate ? formatDateInput(invoice.dueDate) : ''} className="rounded border px-2 py-1" />
                              <button className="rounded bg-blue-600 px-3 py-1 text-white">Save Draft</button>
                            </form>
                          </details>
                        )}
                        {canIssue && (
                          <details>
                            <summary className="cursor-pointer text-blue-700">Issue</summary>
                            <form action={issueInvoiceAction} className="mt-2 grid gap-2 min-w-48">
                              <input type="hidden" name="invoiceId" value={invoice.id} />
                              <input name="dueDate" type="date" required defaultValue={invoice.dueDate ? formatDateInput(invoice.dueDate) : ''} className="rounded border px-2 py-1" />
                              <button className="rounded bg-emerald-600 px-3 py-1 text-white">Issue Invoice</button>
                            </form>
                          </details>
                        )}
                        {canPay && (
                          <details>
                            <summary className="cursor-pointer text-emerald-700">Record Payment</summary>
                            <form action={recordInvoicePaymentAction} className="mt-2 grid gap-2 min-w-64">
                              <input type="hidden" name="invoiceId" value={invoice.id} />
                              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                              <div className="text-xs text-slate-600">Total {Number(invoice.totalAmount).toFixed(2)} · Paid {Number(invoice.totalPaid).toFixed(2)} · Balance {Number(invoice.outstandingBalance).toFixed(2)}</div>
                              <input name="amount" type="number" min="0.01" max={Number(invoice.outstandingBalance).toFixed(2)} step="0.01" required className="rounded border px-2 py-1" />
                              <input name="paymentDate" type="date" required defaultValue={formatDateInput(new Date())} className="rounded border px-2 py-1" />
                              <select name="paymentMethod" required className="rounded border px-2 py-1">
                                {['CASH', 'BANK_TRANSFER', 'CARD', 'MOBILE_BANKING', 'OTHER'].map((method) => <option key={method} value={method}>{method.replaceAll('_', ' ')}</option>)}
                              </select>
                              <input name="referenceNumber" placeholder="Reference / transaction number" className="rounded border px-2 py-1" />
                              <textarea name="notes" placeholder="Notes" className="rounded border px-2 py-1" />
                              <button className="rounded bg-emerald-600 px-3 py-1 text-white">Confirm Payment</button>
                            </form>
                          </details>
                        )}
                        {canViewPayments && invoice.payments.length > 0 && (
                          <details>
                            <summary className="cursor-pointer text-slate-700">Payment History</summary>
                            <div className="mt-2 min-w-64 space-y-2 text-xs">
                              {invoice.payments.map((payment) => (
                                <div key={payment.id} className="rounded border p-2">
                                  <div><strong>{Number(payment.amount).toFixed(2)}</strong> · {payment.paymentMethod.replaceAll('_', ' ')}</div>
                                  <div>{payment.paymentDate.toLocaleDateString()}</div>
                                  {payment.referenceNumber && <div>Ref: {payment.referenceNumber}</div>}
                                  {payment.notes && <div>{payment.notes}</div>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {canCancel && (
                          <form action={cancelInvoiceAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <button className="text-red-700">Cancel</button>
                          </form>
                        )}
                        {canEdit && (
                          <form action={deleteDraftInvoiceAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <button className="text-red-700">Delete</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    SENT: 'bg-blue-100 text-blue-700',
    PARTIALLY_PAID: 'bg-amber-100 text-amber-700',
    PAID: 'bg-emerald-100 text-emerald-700',
    OVERDUE: 'bg-red-100 text-red-700',
    CANCELLED: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status] ?? styles.DRAFT}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}
