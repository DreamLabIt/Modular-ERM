import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/core/auth/module-guard';
import { pageMessage } from '@/core/auth/action';
import { ActionMessage, StatusBadge } from '@/core/ui/ActionMessage';
import { getApprovalRequestDetails } from '@/core/workflows/engine';
import { can } from '@/core/auth/authorization';
import { approveAction, rejectAction, cancelApprovalAction, resubmitApprovalAction } from '../../workflows/actions';

export const dynamic = 'force-dynamic';

export default async function ApprovalDetailPage({
  params,
  searchParams = {},
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tenant = await requirePermission('workflow.view');
  const message = pageMessage(searchParams);
  const request = await getApprovalRequestDetails(tenant.organizationId, params.id);
  if (!request) notFound();

  const canApprove = can(tenant, 'workflow.approve') && request.status === 'PENDING';
  const isRequester = request.requesterId === tenant.userId;
  const payload = request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)
    ? request.payload as Record<string, unknown>
    : {};

  return (
    <div className="max-w-5xl space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/approvals" className="text-xs font-semibold text-blue-600 hover:underline">← All approvals</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{request.title}</h1>
          <p className="text-sm text-slate-500">
            {request.workflow?.name ?? 'Direct approval'} · {request.moduleKey} / {request.resourceType} · Submitted by {request.requester.name}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <ActionMessage message={message} />

      {canApprove && (
        <section className="bg-white rounded-xl border border-blue-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Your Decision</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <form action={approveAction} className="space-y-3">
              <input type="hidden" name="requestId" value={request.id} />
              <label className="block text-xs font-semibold text-slate-700">Comment (optional)</label>
              <textarea name="comment" rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Approve</button>
            </form>
            <form action={rejectAction} className="space-y-3">
              <input type="hidden" name="requestId" value={request.id} />
              <label className="block text-xs font-semibold text-slate-700">Rejection reason (required)</label>
              <textarea name="comment" rows={3} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button type="submit" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Reject</button>
            </form>
          </div>
        </section>
      )}

      {request.status === 'PENDING' && isRequester && (
        <form action={cancelApprovalAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <input name="reason" placeholder="Cancellation reason" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="ml-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Cancel Request</button>
        </form>
      )}

      {['REJECTED', 'CANCELLED'].includes(request.status) && isRequester && (
        <form action={resubmitApprovalAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Resubmit (attempt {(request.attempt ?? 1) + 1})</button>
        </form>
      )}

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Approval Steps</h2>
        <ol className="space-y-3">
          {request.steps.map((step) => (
            <li key={step.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
              <div>
                <div className="font-semibold text-sm">{step.stepOrder}. {step.name}</div>
                <div className="text-[11px] text-slate-500">
                  {step.approvalMode} · minimum {step.minApprovals} approval(s)
                  {step.dueAt ? ` · due ${step.dueAt.toISOString().slice(0, 16).replace('T', ' ')}` : ''}
                </div>
              </div>
              <StatusBadge status={step.status} />
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">History</h2>
        <div className="space-y-3">
          {request.actions.map((action) => (
            <div key={action.id} className="border-l-2 border-slate-200 pl-4">
              <div className="text-sm font-semibold">{action.action} · {action.actor.name}</div>
              <div className="text-[11px] text-slate-500">{action.createdAt.toISOString().replace('T', ' ').slice(0, 19)}{action.comment ? ` · ${action.comment}` : ''}</div>
            </div>
          ))}
          {request.actions.length === 0 && <p className="text-sm text-slate-500">No history recorded.</p>}
        </div>
      </section>

      {Object.keys(payload).length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Submitted Data</h2>
          <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-xs text-slate-700">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
