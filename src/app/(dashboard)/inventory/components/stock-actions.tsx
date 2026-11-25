'use client';

import { useState } from 'react';
import {
  adjustStockAction,
  stockInAction,
  stockOutAction,
  transferStockAction,
} from '@/modules/inventory/actions';
import type { ServiceResult } from '@/modules/inventory/types';

interface WarehouseOption { id: string; name: string; quantity: number }

interface StockActionsProps {
  productId: string;
  warehouses: WarehouseOption[];
}

type ActionKind = 'IN' | 'OUT' | 'TRANSFER' | 'ADJUST';

export function StockActions({ productId, warehouses }: StockActionsProps) {
  const [kind, setKind] = useState<ActionKind | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData, fn: (formData: FormData) => Promise<ServiceResult>, successMessage: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fn(formData);
      if (response.success) {
        setResult(successMessage);
        setKind(null);
      } else {
        setError(response.error);
      }
    } finally {
      setBusy(false);
    }
  }

  const defaultWarehouse = warehouses[0]?.id ?? '';

  return (
    <div className="flex flex-wrap gap-2">
      <a href="/inventory/stock-ledger" className="text-blue-700 text-xs hover:underline">Ledger</a>
      <a href="/inventory/reservations" className="text-blue-700 text-xs hover:underline">Reservations</a>
      <button type="button" onClick={() => { setKind(kind === 'IN' ? null : 'IN'); setError(null); setResult(null); }} className="text-emerald-700 text-xs">Stock In</button>
      <button type="button" onClick={() => { setKind(kind === 'OUT' ? null : 'OUT'); setError(null); setResult(null); }} className="text-red-700 text-xs">Stock Out</button>
      <button type="button" onClick={() => { setKind(kind === 'TRANSFER' ? null : 'TRANSFER'); setError(null); setResult(null); }} className="text-blue-700 text-xs">Transfer</button>
      <button type="button" onClick={() => { setKind(kind === 'ADJUST' ? null : 'ADJUST'); setError(null); setResult(null); }} className="text-slate-700 text-xs">Adjust</button>

      {kind === 'IN' && (
        <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget), stockInAction, 'Stock received.'); }} className="grid gap-1 min-w-52">
          <input type="hidden" name="productId" value={productId} />
          <select name="warehouseId" className="rounded border px-2 py-1 text-xs" defaultValue={defaultWarehouse}>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <input name="quantity" type="number" min={1} step={1} required placeholder="Quantity" className="rounded border px-2 py-1 text-xs" />
          <input name="referenceNumber" placeholder="Reference #" className="rounded border px-2 py-1 text-xs" />
          <button type="submit" disabled={busy} className="rounded bg-emerald-600 px-2 py-1 text-white text-xs disabled:opacity-50">Confirm Stock In</button>
        </form>
      )}

      {kind === 'OUT' && (
        <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget), stockOutAction, 'Stock issued.'); }} className="grid gap-1 min-w-52">
          <input type="hidden" name="productId" value={productId} />
          <select name="warehouseId" className="rounded border px-2 py-1 text-xs" defaultValue={defaultWarehouse}>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <input name="quantity" type="number" min={1} step={1} required placeholder="Quantity" className="rounded border px-2 py-1 text-xs" />
          <input name="notes" placeholder="Notes" className="rounded border px-2 py-1 text-xs" />
          <button type="submit" disabled={busy} className="rounded bg-red-600 px-2 py-1 text-white text-xs disabled:opacity-50">Confirm Stock Out</button>
        </form>
      )}

      {kind === 'TRANSFER' && (
        <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget), transferStockAction, 'Stock transferred.'); }} className="grid gap-1 min-w-52">
          <input type="hidden" name="productId" value={productId} />
          <select name="fromWarehouseId" className="rounded border px-2 py-1 text-xs" defaultValue={defaultWarehouse}>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <select name="toWarehouseId" className="rounded border px-2 py-1 text-xs">
            <option value="">Destination warehouse</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <input name="quantity" type="number" min={1} step={1} required placeholder="Quantity" className="rounded border px-2 py-1 text-xs" />
          <button type="submit" disabled={busy} className="rounded bg-blue-600 px-2 py-1 text-white text-xs disabled:opacity-50">Transfer</button>
        </form>
      )}

      {kind === 'ADJUST' && (
        <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget), adjustStockAction, 'Adjustment posted.'); }} className="grid gap-1 min-w-52">
          <input type="hidden" name="productId" value={productId} />
          <select name="warehouseId" className="rounded border px-2 py-1 text-xs" defaultValue={defaultWarehouse}>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <select name="adjustmentType" className="rounded border px-2 py-1 text-xs">
            {['INCREASE', 'DECREASE', 'DAMAGED', 'LOST', 'EXPIRED', 'COUNT_CORRECTION'].map((type) => (
              <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>
            ))}
          </select>
          <input name="quantity" type="number" min={1} step={1} required placeholder="Quantity / new count" className="rounded border px-2 py-1 text-xs" />
          <input name="reason" required placeholder="Reason" className="rounded border px-2 py-1 text-xs" />
          <button type="submit" disabled={busy} className="rounded bg-slate-800 px-2 py-1 text-white text-xs disabled:opacity-50">Post Adjustment</button>
        </form>
      )}

      {error && <span className="text-xs text-red-700">{error}</span>}
      {result && <span className="text-xs text-emerald-700">{result}</span>}
    </div>
  );
}
