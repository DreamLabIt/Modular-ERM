'use client';

import { useState } from 'react';
import type { Prisma } from '@prisma/client';
import { createPurchaseOrderAction, type ActionResult } from '@/modules/sales_purchase/actions';

interface SupplierOption { id: string; name: string }
interface ProductOption { id: string; name: string; costPrice: string | number | Prisma.Decimal }
interface WarehouseOption { id: string; name: string }

interface PoItemRow { productId: string; quantity: string }

interface PoCreateFormProps {
  suppliers: SupplierOption[];
  products: ProductOption[];
  warehouses: WarehouseOption[];
}

export function PoCreateForm({ suppliers, products, warehouses }: PoCreateFormProps) {
  const [rows, setRows] = useState<PoItemRow[]>([{ productId: '', quantity: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const setRow = (index: number, patch: Partial<PoItemRow>) =>
    setRows((current) => current.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  const addRow = () => setRows((current) => [...current, { productId: '', quantity: '' }]);
  const removeRow = (index: number) =>
    setRows((current) => current.filter((_, idx) => idx !== index));

  const productById = new Map(products.map((product) => [product.id, product]));
  const totalPreview = rows.reduce((sum, row) => {
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(productById.get(row.productId)?.costPrice || 0);
    return sum + quantity * unitPrice;
  }, 0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const formData = new FormData(event.currentTarget);
    const items = rows
      .filter((row) => row.productId && Number(row.quantity) > 0)
      .map((row) => ({ productId: row.productId, quantity: Number(row.quantity) }));
    formData.set('items', JSON.stringify(items));
    const result: ActionResult = await createPurchaseOrderAction(formData);
    if (result.success) {
      setMessage('Purchase Order created. It starts in DRAFT status — no stock was changed.');
      setRows([{ productId: '', quantity: '' }]);
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select name="supplierId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Select supplier</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <select name="warehouseId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Select warehouse</option>
          {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
        <input name="expectedDate" type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Expected delivery" />
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
            <select
              value={row.productId}
              onChange={(event) => setRow(index, { productId: event.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Product</option>
              {products.map((product) => (
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
              {row.productId ? `×${productById.get(row.productId)?.name ?? ''}` : ''}
            </div>
            <div className="flex gap-2">
              {rows.length > 1 && (
                <button type="button" onClick={() => removeRow(index)} className="text-red-600">
                  Remove
                </button>
              )}
              <button type="button" onClick={addRow} className="text-blue-600">
                Add item
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Estimated total: {totalPreview.toLocaleString()}</span>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {message && <p className="text-xs text-emerald-700">{message}</p>}

      <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
        Create Purchase Order
      </button>
    </form>
  );
}

export type { ActionResult };
