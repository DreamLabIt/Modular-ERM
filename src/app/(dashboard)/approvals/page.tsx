import Link from 'next/link';
import { requirePermission } from '@/core/auth/module-guard';
import { pageMessage } from '@/core/auth/action';
import { ActionMessage, StatusBadge } from '@/core/ui/ActionMessage';
import { listPendingApprovalsForUser } from '@/core/workflows/engine';
import { listApprovalRequests } from '@/core/workflows/management';
import { can } from '@/core/auth/authorization';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tenant = await requirePermission('workflow.view');
  const message = pageMessage(searchParams);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const status = typeof searchParams.status === 'string' ? searchParams.status : '';

  const [mine, all] = await Promise.all([
    listPendingApprovalsForUser(tenant.organizationId, tenant.userId, tenant.roleId),
    listApprovalRequests({
      organizationId: tenant.organizationId,
      page,
      status: status || undefined,
      requesterId: can(tenant, 'workflow.manage') ? undefined : tenant.userId,
    }),
  ]);

  const thClass = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="max-w-7xl space-y-8 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Approvals</h1>
          <p className="text-sm text-slate-500">Review requests assigned to you, including delegated approvals.</p>
        </div>
        <Link href="/workflows" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Workflow Settings →</Link>
      </div>

      <ActionMessage message={message} />

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Awaiting Your Decision</h2>
        <div className="space-y-3">
          {mine.map((request) => {
            const step = request.steps.find((candidate) => candidate.stepOrder === request.currentStep && candidate.status === 'ACTIVE');
            return (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
                <div>
                  <div className="font-semibold text-slate-900">{request.title}</div>
                  <div className="text-xs text-slate-500">
                    Requested by {request.requester.name} · {request.workflow?.name ?? 'Direct approval'} · Step {request.currentStep}{step ? ` (${step.name})` : ''}
                  </div>
                  <div className="text-[11px] text-slate-500">{request.moduleKey} / {request.resourceType}</div>
                </div>
                <Link href={`/approvals/${request.id}`} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">Review</Link>
              </div>
            );
          })}
          {mine.length === 0 && <p className="text-sm text-slate-500">No approvals are waiting for you.</p>}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">All Requests</h2>
          <form className="flex gap-2">
            <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs">
              <option value="">All statuses</option>
              <option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>CANCELLED</option>
            </select>
            <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white" type="submit">Filter</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>
              <th className={thClass}>Title</th><th className={thClass}>Requester</th><th className={thClass}>Module</th>
              <th className={thClass}>Step</th><th className={thClass}>Status</th><th className={thClass}>Submitted</th><th />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {all.rows.map((request) => (
                <tr key={request.id}>
                  <td className="py-2 pr-3 font-medium">{request.title}</td>
                  <td className="py-2 pr-3">{request.requester.name}</td>
                  <td className="py-2 pr-3">{request.moduleKey} / {request.resourceType}</td>
                  <td className="py-2 pr-3">{request.currentStep} / {request.steps.length}</td>
                  <td className="py-2 pr-3"><StatusBadge status={request.status} /></td>
                  <td className="py-2 pr-3">{request.submittedAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td><Link href={`/approvals/${request.id}`} className="text-xs font-semibold text-blue-600 hover:underline">Details</Link></td>
                </tr>
              ))}
              {all.rows.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-500">No approval requests found.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Page {all.page} of {all.pageCount} · {all.total} requests</p>
      </section>
    </div>
  );
}
