import { requirePlatformAdmin } from '@/core/auth/platform';
import { listAllPayments } from '@/core/billing/payments/service';
import { prisma } from '@/core/db/prisma';
import { approveManualPaymentAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PlatformPaymentsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePlatformAdmin();
  const [payments, attempts] = await Promise.all([
    listAllPayments(200),
    prisma.paymentAttempt.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const th = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase text-slate-500';
  return (
    <div className="space-y-8 pb-12">
      <div><h1 className="text-2xl font-bold text-slate-900">Payments</h1><p className="text-sm text-slate-500">Manual bank transfers require explicit approval; gateway payments require verification.</p></div>
      {searchParams.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</div>}
      {searchParams.success && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{searchParams.success}</div>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead><tr><th className={th}>Organization</th><th className={th}>Provider</th><th className={th}>Amount</th><th className={th}>Status</th><th className={th}>Reference</th><th className={th}>Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td className="py-2 pr-3">{payment.organization.name}</td>
                <td className="py-2 pr-3">{payment.provider}</td>
                <td className="py-2 pr-3">{payment.currency} {payment.amount.toString()}</td>
                <td className="py-2 pr-3">{payment.status}</td>
                <td className="py-2 pr-3 font-mono text-[10px]">{payment.providerReference?.slice(0, 20) ?? '—'}</td>
                <td className="py-2 pr-3">
                  {payment.status === 'PENDING' && payment.provider === 'MANUAL_BANK' && (
                    <form action={approveManualPaymentAction}>
                      <input type="hidden" name="organizationId" value={payment.organizationId} />
                      <input type="hidden" name="paymentId" value={payment.id} />
                      <button className="font-semibold text-emerald-700 hover:underline">Approve</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={6} className="p-4 text-slate-500">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent payment attempts</h2>
        <div className="space-y-1 text-xs text-slate-600">
          {attempts.map((attempt) => <div key={attempt.id}>{attempt.createdAt.toISOString().slice(0, 16).replace('T', ' ')} · {attempt.provider} · {attempt.status} · {attempt.errorMessage ?? attempt.reference ?? '—'}</div>)}
          {attempts.length === 0 && <p>No attempts recorded.</p>}
        </div>
      </section>
    </div>
  );
}
