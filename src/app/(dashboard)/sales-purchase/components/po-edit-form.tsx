'use client';

import { useState } from 'react';
import type { Prisma } from '@prisma/client';
import { editPurchaseOrderAction, type ActionResult } from '@/modules/sales_purchase/actions';

interface SupplierOption { id: string; name: string }
interface ProductOption { id: string; name: string; costPrice: string | number | Prisma.Decimal }
interface WarehouseOption { id: string; name: string }

interface PoEditItemRow { productId: string; quantity: string; }

interface PoEditFormProps {
  purchaseOrderId: string;
  supplierOptions: SupplierOption[];
  productOptions: ProductOption[];
  warehouseOptions: WarehouseOption[];
  initialSupplierId: string;
  initialWarehouseId: string;
  initialExpectedDate: string;
  initialItems: Array<{ productId: string; quantity: number; notes?: string | null }>;
}

export function PoEditForm({
  purchaseOrderId,
  supplierOptions,
  productOptions,
  warehouseOptions,
  initialSupplierId,
  initialWarehouseId,
  initialExpectedDate,
  initialItems,
}: PoEditFormProps) {
  const [supplierId] = useState(initialSupplierId);
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [expectedDate, setExpectedDate] = useState(initialExpectedDate);
  const [rows, setRows] = useState<PoEditItemRow[]>(
    initialItems.map((item) => ({ productId: item.productId, quantity: String(item.quantity) })),
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const setRow = (index: number, patch: Partial<PoEditItemRow>) =>
    setRows((current) => current.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  const addRow = () => setRows((current) => [...current, { productId: '', quantity: '' }]);
  const removeRow = (index: number) =>
    setRows((current) => current.filter((_, idx) => idx !== index));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const formData = new FormData(event.currentTarget);
    const items = rows
      .filter((row) => row.productId && Number(row.quantity) > 0)
      .map((row) => ({ productId: row.productId, quantity: Number(row.quantity) }));
    formData.set('items', JSON.stringify(items));
    const result: ActionResult = await editPurchaseOrderAction(formData);
    if (result.success) setMessage('Purchase Order updated.');
    else setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <select name="supplierId" defaultValue={supplierId} required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
        {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
      </select>
      <select name="warehouseId" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
        {warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
      </select>
      <input
        name="expectedDate"
        type="date"
        value={expectedDate}
        onChange={(event) => setExpectedDate(event.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="sm:col-span-3 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
            <select
              value={row.productId}
              onChange={(event) => setRow(index, { productId: event.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Product</option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({Number(product.costPrice).toFixed(2)})
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              step={1}
              value={row.quantity}
              onChange={(event) => setRow(index, { quantity: event.target.value })}
              placeholder="Quantity"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="text-sm text-slate-500">
              {row.productId ? `×${productOptions.find((p) => p.id === row.productId)?.name ?? ''}` : ''}
            </div>
            <div className="flex gap-2">
              {rows.length > 1 && (
                <button type="button" onClick={() => removeRow(index)} className="text-red-600 text-xs">
                  Remove
                </button>
              )}
              <button type="button" onClick={addRow} className="text-blue-600 text-xs">
                Add item
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
        Save Draft
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {message && <p className="text-xs text-emerald-700">{message}</p>}
    </form>
  );
}
