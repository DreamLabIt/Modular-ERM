'use client';

import { useState } from 'react';
import { createGoodsReceiptAction, type ActionResult } from '@/modules/sales_purchase/actions';

interface GrnLine {
  purchaseOrderItemId: string;
  productId: string;
  productName: string;
  unitCost: string;
  orderedQuantity: number;
  previouslyReceived: number;
  remaining: number;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  notes?: string;
}

interface GrnCreateFormProps {
  purchaseOrderId: string;
  lines: GrnLine[];
}

export function GrnCreateForm({ purchaseOrderId, lines }: GrnCreateFormProps) {
  const [rows, setRows] = useState(lines.map((line) => ({ ...line })));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const setRow = (index: number, patch: Partial<typeof rows[number]>) =>
    setRows((current) => current.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const formData = new FormData(event.currentTarget);

    const items = rows
      .map((row) => ({
        purchaseOrderItemId: row.purchaseOrderItemId,
        productId: row.productId,
        orderedQuantity: row.orderedQuantity,
        previouslyReceived: row.previouslyReceived,
        receivedQuantity: Number(row.receivedQuantity || 0),
        acceptedQuantity: Number(row.acceptedQuantity || 0),
        rejectedQuantity: Number(row.rejectedQuantity || 0),
        unitCost: Number(row.unitCost),
        notes: row.notes || undefined,
      }))
      .filter((row) => row.receivedQuantity > 0);

    formData.set('items', JSON.stringify(items));
    const result: ActionResult = await createGoodsReceiptAction(formData);
    if (result.success) setMessage('Goods receipt saved. Accepted quantities increased stock.');
    else setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
          <tr>
            <th className="px-4 py-2">Product</th>
            <th className="px-4 py-2 text-right">Ordered</th>
            <th className="px-4 py-2 text-right">Previously Received</th>
            <th className="px-4 py-2 text-right">Remaining</th>
            <th className="px-4 py-2 text-right">Current Received</th>
            <th className="px-4 py-2 text-right">Accepted</th>
            <th className="px-4 py-2 text-right">Rejected</th>
            <th className="px-4 py-2 text-right">Unit Cost</th>
            <th className="px-4 py-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map((row, index) => {
            const received = Number(row.receivedQuantity || 0);
            const accepted = Number(row.acceptedQuantity || 0);
            const rejected = Number(row.rejectedQuantity || 0);
            const sumError = accepted + rejected !== received;
            const overError = received > row.remaining;
            return (
              <tr key={row.purchaseOrderItemId}>
                <td className="px-4 py-2 font-mono text-xs font-semibold">{row.productName}</td>
                <td className="px-4 py-2 text-right">{row.orderedQuantity}</td>
                <td className="px-4 py-2 text-right">{row.previouslyReceived}</td>
                <td className="px-4 py-2 text-right font-bold">{row.remaining}</td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={row.receivedQuantity}
                    onChange={(event) => setRow(index, { receivedQuantity: event.target.value })}
                    className="w-20 rounded border px-2 py-1 text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={row.acceptedQuantity}
                    onChange={(event) => setRow(index, { acceptedQuantity: event.target.value })}
                    className="w-20 rounded border px-2 py-1 text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={row.rejectedQuantity}
                    onChange={(event) => setRow(index, { rejectedQuantity: event.target.value })}
                    className="w-20 rounded border px-2 py-1 text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right font-mono">{Number(row.unitCost).toFixed(2)}</td>
                <td className="px-4 py-2">
                  <input
                    value={row.notes ?? ''}
                    onChange={(event) => setRow(index, { notes: event.target.value })}
                    className="w-32 rounded border px-2 py-1 text-xs"
                  />
                  {(sumError || overError) && (
                    <span className="ml-2 text-xs text-red-700">
                      {sumError ? 'Received must equal accepted + rejected.' : ''}
                      {overError ? 'Cannot receive more than remaining.' : ''}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <button type="submit" className="rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 px-4 py-2">
        Record Goods Receipt
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {message && <p className="text-xs text-emerald-700">{message}</p>}
    </form>
  );
}
