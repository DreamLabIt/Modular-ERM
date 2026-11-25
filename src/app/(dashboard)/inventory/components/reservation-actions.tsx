'use client';

import { useState } from 'react';
import { consumeReservationAction, expireStaleReservationsAction, releaseReservationAction } from '@/modules/inventory/actions';
import type { ServiceResult } from '@/modules/inventory/types';

export function ExpireReservationsButton() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          setError(null);
          setResult(null);
          const response = await expireStaleReservationsAction();
          if (response.success) setResult('Expired reservations processed.');
          else setError(response.error);
        }}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        Expire stale reservations
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
      {result && <span className="text-xs text-emerald-700">{result}</span>}
    </div>
  );
}

export function ReservationActions({ reservationId, active }: { reservationId: string; active: boolean }) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: (formData: FormData) => Promise<ServiceResult>, message: string) {
    setError(null);
    setResult(null);
    const formData = new FormData();
    formData.set('reservationId', reservationId);
    const response = await action(formData);
    if (response.success) setResult(message);
    else setError(response.error);
  }

  if (!active) return <span className="text-xs text-slate-400">—</span>;

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void run(releaseReservationAction, 'Reservation released.')} className="text-blue-700 text-xs">Release</button>
      <button type="button" onClick={() => void run(consumeReservationAction, 'Reservation consumed; stock deducted.')} className="text-emerald-700 text-xs">Consume</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
      {result && <span className="text-xs text-emerald-700">{result}</span>}
    </div>
  );
}
