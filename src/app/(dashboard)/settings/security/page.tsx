import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequiredTenantSession } from '@/core/auth/session';
import { canAny, can } from '@/core/auth/authorization';
import { pageMessage } from '@/core/auth/action';
import { ActionMessage, StatusBadge } from '@/core/ui/ActionMessage';
import { searchAuditLogs } from '@/core/audit';
import { searchLoginHistory } from '@/core/security/login-history';
import { listOrganizationSessions, listUserSessions } from '@/core/security/sessions';
import { prisma } from '@/core/db/prisma';
import { revokeSessionAction, revokeAllUserSessionsAction } from './actions';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function value(params: SearchParams, key: string): string {
  const found = params[key];
  return typeof found === 'string' ? found : '';
}

export default async function SecurityPage({
  searchParams = {},
}: {
  searchParams?: SearchParams;
}) {
  const tenant = await getRequiredTenantSession();
  if (!canAny(tenant, ['audit.view', 'login_history.view', 'sessions.manage'])) {
    redirect('/dashboard?error=unauthorized');
  }
  const message = pageMessage(searchParams);
  const page = Math.max(1, Number(value(searchParams, 'page')) || 1);
  const from = value(searchParams, 'from') ? new Date(value(searchParams, 'from')) : undefined;
  const to = value(searchParams, 'to') ? new Date(value(searchParams, 'to')) : undefined;

  const canAudit = can(tenant, 'audit.view');
  const canLogins = can(tenant, 'login_history.view') || canAudit;
  const canSessions = can(tenant, 'sessions.manage') || canAudit;

  const [audits, logins, sessions, users] = await Promise.all([
    canAudit
      ? searchAuditLogs({
          organizationId: tenant.organizationId,
          page,
          resource: value(searchParams, 'resource') || undefined,
          action: value(searchParams, 'action') || undefined,
          userId: value(searchParams, 'userId') || undefined,
          from,
          to,
          search: value(searchParams, 'search') || undefined,
        })
      : { rows: [], total: 0, page, pageSize: 25, pageCount: 1 },
    canLogins
      ? searchLoginHistory({
          organizationId: tenant.organizationId,
          page,
          email: value(searchParams, 'email') || undefined,
          status: value(searchParams, 'loginStatus') || undefined,
          from,
          to,
        })
      : { rows: [], total: 0, page, pageSize: 25, pageCount: 1 },
    canSessions ? listOrganizationSessions(tenant.organizationId) : [],
    prisma.user.findMany({
      where: { organizationId: tenant.organizationId },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const selectedUserId = value(searchParams, 'sessionUserId');
  const visibleSessions = selectedUserId
    ? await listUserSessions(tenant.organizationId, selectedUserId)
    : sessions;

  const inputClass = 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs';
  const thClass = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="max-w-7xl space-y-8 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Security, Audit & Sessions</h1>
          <p className="text-sm text-slate-500">
            Immutable audit trail, authentication history and enforceable session revocation.
          </p>
        </div>
        <Link href="/settings" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">← Settings</Link>
      </div>

      <ActionMessage message={message} />

      {canAudit && <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Audit Log</h2>
        <form className="mb-4 flex flex-wrap gap-2">
          <input name="search" defaultValue={value(searchParams, 'search')} placeholder="Search description, action, resource" className={inputClass} />
          <input name="resource" defaultValue={value(searchParams, 'resource')} placeholder="Resource" className={inputClass} />
          <input name="action" defaultValue={value(searchParams, 'action')} placeholder="Action" className={inputClass} />
          <input name="from" type="date" defaultValue={value(searchParams, 'from')} className={inputClass} />
          <input name="to" type="date" defaultValue={value(searchParams, 'to')} className={inputClass} />
          <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white" type="submit">Filter</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>
              <th className={thClass}>When</th><th className={thClass}>Actor</th><th className={thClass}>Action</th>
              <th className={thClass}>Resource</th><th className={thClass}>Description</th><th className={thClass}>IP</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {audits.rows.map((log) => (
                <tr key={log.id} className="align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{log.createdAt.toISOString().replace('T', ' ').slice(0, 19)}</td>
                  <td className="py-2 pr-3">{log.user?.email ?? 'System'}</td>
                  <td className="py-2 pr-3 font-medium">{log.action}</td>
                  <td className="py-2 pr-3">{log.resource}{log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ''}</td>
                  <td className="py-2 pr-3 text-slate-600">{log.description ?? '—'}</td>
                  <td className="py-2 pr-3 text-slate-500">{log.ipAddress ?? '—'}</td>
                </tr>
              ))}
              {audits.rows.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-500">No audit events found.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Page {audits.page} of {audits.pageCount} · {audits.total} events</p>
      </section>}

      {canLogins && <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Login History</h2>
        <form className="mb-4 flex flex-wrap gap-2">
          <input name="email" defaultValue={value(searchParams, 'email')} placeholder="Email" className={inputClass} />
          <select name="loginStatus" defaultValue={value(searchParams, 'loginStatus')} className={inputClass}>
            <option value="">All statuses</option><option>SUCCESS</option><option>FAILED</option><option>BLOCKED</option><option>LOGOUT</option>
          </select>
          <input name="from" type="date" defaultValue={value(searchParams, 'from')} className={inputClass} />
          <input name="to" type="date" defaultValue={value(searchParams, 'to')} className={inputClass} />
          <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white" type="submit">Filter</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>
              <th className={thClass}>When</th><th className={thClass}>Email</th><th className={thClass}>Status</th>
              <th className={thClass}>Reason</th><th className={thClass}>Device</th><th className={thClass}>IP</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {logins.rows.map((login) => (
                <tr key={login.id}>
                  <td className="py-2 pr-3 whitespace-nowrap">{login.createdAt.toISOString().replace('T', ' ').slice(0, 19)}</td>
                  <td className="py-2 pr-3">{login.email}</td>
                  <td className="py-2 pr-3"><StatusBadge status={login.status} /></td>
                  <td className="py-2 pr-3">{login.failureReason ?? '—'}</td>
                  <td className="py-2 pr-3">{login.device ?? '—'}</td>
                  <td className="py-2 pr-3">{login.ipAddress ?? '—'}</td>
                </tr>
              ))}
              {logins.rows.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-500">No login events found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {canSessions && <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Active & Revoked Sessions</h2>
            <p className="text-xs text-slate-500">Revocation takes effect on the next request, even if the JWT is still valid.</p>
          </div>
          <form className="flex gap-2">
            <select name="sessionUserId" defaultValue={selectedUserId} className={inputClass}>
              <option value="">All users</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}
            </select>
            <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white">Filter</button>
          </form>
        </div>
        {selectedUserId && (
          <form action={revokeAllUserSessionsAction} className="mb-4">
            <input type="hidden" name="userId" value={selectedUserId} />
            <button type="submit" className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
              Revoke all sessions for this user
            </button>
          </form>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>
              <th className={thClass}>User</th><th className={thClass}>Device</th><th className={thClass}>Created</th>
              <th className={thClass}>Last Seen</th><th className={thClass}>Expires</th><th className={thClass}>Status</th><th />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleSessions.map((session) => (
                <tr key={session.id}>
                  <td className="py-2 pr-3">{users.find((u) => u.id === session.userId)?.email ?? session.userId}</td>
                  <td className="py-2 pr-3">{session.device ?? 'Unknown device'}</td>
                  <td className="py-2 pr-3">{session.createdAt.toISOString().replace('T', ' ').slice(0, 19)}</td>
                  <td className="py-2 pr-3">{session.lastSeenAt.toISOString().replace('T', ' ').slice(0, 19)}</td>
                  <td className="py-2 pr-3">{session.expiresAt.toISOString().slice(0, 10)}</td>
                  <td className="py-2 pr-3"><StatusBadge status={session.revokedAt ? 'REVOKED' : 'ACTIVE'} /></td>
                  <td className="py-2 pr-3">
                    {!session.revokedAt && (
                      <form action={revokeSessionAction}>
                        <input type="hidden" name="sessionId" value={session.id} />
                        <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">Revoke</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {visibleSessions.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-500">No sessions found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
  );
}
