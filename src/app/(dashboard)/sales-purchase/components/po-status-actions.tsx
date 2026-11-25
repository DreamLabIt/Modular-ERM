'use client';

import { useState } from 'react';
import {
  approvePurchaseOrderAction,
  cancelPurchaseOrderAction,
  rejectPurchaseOrderAction,
  sendPurchaseOrderAction,
  submitPurchaseOrderForApprovalAction,
} from '@/modules/sales_purchase/actions';
import type { ActionResult } from '@/modules/sales_purchase/actions';
import type { PurchaseOrderStatus } from '@/modules/sales_purchase/workflow';

interface PoStatusActionsProps {
  purchaseOrderId: string;
  status: PurchaseOrderStatus;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canSend: boolean;
  canCancel: boolean;
}

async function runAction(fn: () => Promise<ActionResult>, setMessage: (message: string | null) => void, setError: (error: string | null) => void) {
  setError(null);
  const result = await fn();
  if (result.success) setMessage(result.message ?? 'Action completed.');
  else setError(result.error);
}

export function PoStatusActions({
  purchaseOrderId,
  status,
  canSubmit,
  canApprove,
  canReject,
  canSend,
  canCancel,
}: PoStatusActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<ActionResult>) => {
    setBusy(true);
    try {
      await runAction(fn, setMessage, setError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'DRAFT' && canSubmit && (
        <button
          disabled={busy}
          onClick={() => run(() => submitPurchaseOrderForApprovalAction(purchaseOrderId))}
          className="rounded bg-blue-600 px-3 py-1 text-white text-xs disabled:opacity-50"
        >
          Submit for Approval
        </button>
      )}
      {status === 'PENDING_APPROVAL' && canApprove && (
        <button
          disabled={busy}
          onClick={() => run(() => approvePurchaseOrderAction(purchaseOrderId))}
          className="rounded bg-emerald-600 px-3 py-1 text-white text-xs disabled:opacity-50"
        >
          Approve
        </button>
      )}
      {status === 'PENDING_APPROVAL' && canReject && (
        <button
          disabled={busy}
          onClick={() => {
            const reason = window.prompt('Rejection reason:') ?? '';
            run(() => rejectPurchaseOrderAction(purchaseOrderId, reason));
          }}
          className="rounded bg-red-600 px-3 py-1 text-white text-xs disabled:opacity-50"
        >
          Reject
        </button>
      )}
      {status === 'APPROVED' && canSend && (
        <button
          disabled={busy}
          onClick={() => run(() => sendPurchaseOrderAction(purchaseOrderId))}
          className="rounded bg-blue-600 px-3 py-1 text-white text-xs disabled:opacity-50"
        >
          Send to Supplier
        </button>
      )}
      {(status === 'APPROVED' || status === 'SENT' || status === 'PARTIALLY_RECEIVED') && canCancel && (
        <button
          disabled={busy}
          onClick={() => {
            const reason = window.prompt('Cancellation reason:') ?? '';
            run(() => cancelPurchaseOrderAction(purchaseOrderId, reason));
          }}
          className="rounded bg-slate-700 px-3 py-1 text-white text-xs disabled:opacity-50"
        >
          Cancel
        </button>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
      {message && <span className="text-xs text-emerald-700">{message}</span>}
    </div>
  );
}
