import Link from 'next/link';
import { requirePermission } from '@/core/auth/module-guard';
import { pageMessage } from '@/core/auth/action';
import { ActionMessage, StatusBadge } from '@/core/ui/ActionMessage';
import { prisma } from '@/core/db/prisma';
import {
  listWorkflows,
  listDelegations,
} from '@/core/workflows/management';
import { saveWorkflowAction, toggleWorkflowAction, createDelegationAction, endDelegationAction } from './actions';
import { can } from '@/core/auth/authorization';

export const dynamic = 'force-dynamic';

const MODULE_OPTIONS = [
  'hrm', 'payroll', 'sales_purchase', 'projects', 'accounting', 'inventory', 'crm', 'reports',
];
const RESOURCE_OPTIONS = [
  'LEAVE_REQUEST', 'PAYROLL_RUN', 'PURCHASE_ORDER', 'PROJECT_EXPENSE', 'STOCK_ADJUSTMENT', 'SALES_INVOICE',
];

export default async function WorkflowsPage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tenant = await requirePermission('workflow.view');
  const message = pageMessage(searchParams);
  const [workflows, delegations, roles, users] = await Promise.all([
    listWorkflows(tenant.organizationId),
    listDelegations(tenant.organizationId),
    prisma.role.findMany({ where: { organizationId: tenant.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { organizationId: tenant.organizationId, isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
  ]);
  const canManage = can(tenant, 'workflow.manage');
  const canDelegate = can(tenant, 'workflow.delegate');
  const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const labelClass = 'block text-xs font-semibold text-slate-700';

  return (
    <div className="max-w-7xl space-y-8 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Approval Workflows</h1>
          <p className="text-sm text-slate-500">
            Configure multi-level approvals with safe, structured conditions and delegation.
          </p>
        </div>
        <Link href="/approvals" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">View Approvals →</Link>
      </div>

      <ActionMessage message={message} />

      {canManage && (
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Create Workflow</h2>
          <form action={saveWorkflowAction} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div><label className={labelClass}>Name</label><input name="name" required className={inputClass} /></div>
              <div>
                <label className={labelClass}>Module</label>
                <select name="moduleKey" className={inputClass}>
                  {MODULE_OPTIONS.map((module) => <option key={module}>{module}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Resource Type</label>
                <select name="resourceType" className={inputClass}>
                  {RESOURCE_OPTIONS.map((resource) => <option key={resource}>{resource}</option>)}
                </select>
              </div>
              <div><label className={labelClass}>Description</label><input name="description" className={inputClass} /></div>
            </div>
            <div>
              <label className={labelClass}>Conditions (JSON, optional)</label>
              <textarea
                name="conditions"
                rows={3}
                placeholder={'{"all":[{"field":"amount","operator":"gte","value":10000}]}'}
                className={`${inputClass} font-mono text-xs`}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Supported operators: eq, neq, gt, gte, lt, lte, in, not_in, contains, exists. No JavaScript is executed.
              </p>
            </div>
            <div>
              <label className={labelClass}>Steps (JSON array)</label>
              <textarea
                name="steps"
                rows={6}
                required
                defaultValue={JSON.stringify([
                  {
                    stepOrder: 1,
                    name: 'Manager Approval',
                    approvalMode: 'SEQUENTIAL',
                    minApprovals: 1,
                    approverRoleId: roles.find((role) => role.name === 'Manager')?.id ?? roles[0]?.id ?? null,
                    approverUserId: null,
                    fallbackRoleId: null,
                    dueInHours: 48,
                    condition: null,
                  },
                ], null, 2)}
                className={`${inputClass} font-mono text-xs`}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Set <code>approvalMode</code> to PARALLEL and <code>minApprovals</code> above 1 for committee approvals.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input name="isActive" type="checkbox" defaultChecked className="h-4 w-4" /> Active
            </label>
            <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Create Workflow</button>
          </form>
        </section>
      )}

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Configured Workflows</h2>
        <div className="space-y-3">
          {workflows.map((workflow) => (
            <div key={workflow.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{workflow.name} <span className="text-xs text-slate-500">v{workflow.version}</span></div>
                  <div className="text-xs text-slate-500">{workflow.moduleKey} · {workflow.resourceType} · {workflow._count.requests} request(s)</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={workflow.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  {canManage && (
                    <form action={toggleWorkflowAction}>
                      <input type="hidden" name="id" value={workflow.id} />
                      <input type="hidden" name="isActive" value={workflow.isActive ? 'false' : 'true'} />
                      <button type="submit" className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        {workflow.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {workflow.steps.map((step) => (
                  <div key={step.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-semibold">{step.stepOrder}. {step.name}</span>
                    <div className="text-slate-500">{step.approvalMode} · min {step.minApprovals}{step.dueInHours ? ` · ${step.dueInHours}h SLA` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {workflows.length === 0 && <p className="text-sm text-slate-500">No workflows configured. Approval requests will fall back to direct module approvals.</p>}
        </div>
      </section>

      {canDelegate && (
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Approval Delegations</h2>
          <form action={createDelegationAction} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
            <div>
              <label className={labelClass}>From User</label>
              <select name="fromUserId" required className={inputClass}>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>To User</label>
              <select name="toUserId" required className={inputClass}>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Module (optional)</label>
              <select name="moduleKey" className={inputClass}>
                <option value="">All modules</option>
                {MODULE_OPTIONS.map((module) => <option key={module}>{module}</option>)}
              </select>
            </div>
            <div><label className={labelClass}>Start Date</label><input name="startDate" type="date" required className={inputClass} /></div>
            <div><label className={labelClass}>End Date</label><input name="endDate" type="date" required className={inputClass} /></div>
            <div><label className={labelClass}>Reason</label><input name="reason" required className={inputClass} /></div>
            <div className="md:col-span-3"><button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Create Delegation</button></div>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>
                <th className="py-2 pr-3 text-left text-[11px] uppercase text-slate-500">From</th>
                <th className="py-2 pr-3 text-left text-[11px] uppercase text-slate-500">To</th>
                <th className="py-2 pr-3 text-left text-[11px] uppercase text-slate-500">Period</th>
                <th className="py-2 pr-3 text-left text-[11px] uppercase text-slate-500">Reason</th>
                <th className="py-2 pr-3 text-left text-[11px] uppercase text-slate-500">Status</th><th />
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {delegations.map((delegation) => (
                  <tr key={delegation.id}>
                    <td className="py-2 pr-3">{delegation.fromUser.name}</td>
                    <td className="py-2 pr-3">{delegation.toUser.name}</td>
                    <td className="py-2 pr-3">{delegation.startDate.toISOString().slice(0, 10)} → {delegation.endDate.toISOString().slice(0, 10)}</td>
                    <td className="py-2 pr-3">{delegation.reason}</td>
                    <td className="py-2 pr-3"><StatusBadge status={delegation.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                    <td>
                      {delegation.isActive && (
                        <form action={endDelegationAction}>
                          <input type="hidden" name="id" value={delegation.id} />
                          <button type="submit" className="text-xs text-red-600 hover:underline">End</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                {delegations.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-500">No delegations configured.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
