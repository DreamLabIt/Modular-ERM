import type { pageMessage } from '@/core/auth/action';

type Message = ReturnType<typeof pageMessage>;

export function ActionMessage({ message }: { message: Message }) {
  if (message.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        {message.error}
      </div>
    );
  }
  if (message.success) {
    return (
      <div
        role="status"
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      >
        {message.success}
      </div>
    );
  }
  return null;
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const positive = ['APPROVED', 'COMPLETED', 'SENT', 'ACTIVE', 'VERIFIED', 'DONE', 'SUCCESS'].includes(normalized);
  const negative = ['REJECTED', 'FAILED', 'REVOKED', 'CANCELLED', 'DECLINED'].includes(normalized);
  const warning = ['PENDING', 'PROCESSING', 'QUEUED', 'SKIPPED', 'OPEN'].includes(normalized);
  const className = positive
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : negative
      ? 'bg-red-50 text-red-700 border-red-200'
      : warning
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}>
      {status}
    </span>
  );
}
