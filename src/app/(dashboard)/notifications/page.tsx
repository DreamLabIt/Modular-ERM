import { requirePermission } from '@/core/auth/module-guard';
import { pageMessage } from '@/core/auth/action';
import { ActionMessage, StatusBadge } from '@/core/ui/ActionMessage';
import { prisma } from '@/core/db/prisma';
import {
  searchNotifications,
  listNotificationPreferences,
  notificationProviderStatus,
  NOTIFICATION_CATEGORIES,
} from '@/core/notifications/service';
import { markReadAction, markAllReadAction, archiveNotificationAction, savePreferencesAction, testNotificationChannelAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tenant = await requirePermission('notifications.view');
  const message = pageMessage(searchParams);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const category = typeof searchParams.category === 'string' ? searchParams.category : '';
  const showArchived = searchParams.archived === '1';

  const [notifications, preferences, providers, deliveries, jobs] = await Promise.all([
    searchNotifications({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      page,
      category: category || undefined,
      includeArchived: showArchived,
    }),
    listNotificationPreferences(tenant.organizationId, tenant.userId),
    Promise.resolve(notificationProviderStatus()),
    prisma.notificationDelivery.findMany({
      where: { organizationId: tenant.organizationId, userId: tenant.userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.notificationJob.count({
      where: { organizationId: tenant.organizationId, status: { in: ['PENDING', 'PROCESSING'] } },
    }),
  ]);

  const inputClass = 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs';
  const thClass = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="max-w-7xl space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
        <p className="text-sm text-slate-500">
          In-app, email and SMS notifications with preferences and durable reminders.
        </p>
      </div>

      <ActionMessage message={message} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">Unread</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{notifications.unread}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">Scheduled jobs pending</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{jobs}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">Provider status</div>
          <div className="mt-2 space-y-1 text-xs">
            <div>Email: <StatusBadge status={providers.email.configured ? 'ACTIVE' : 'SKIPPED'} /> <span className="text-slate-500">{providers.email.provider}</span></div>
            <div>SMS: <StatusBadge status={providers.sms.configured ? 'ACTIVE' : 'SKIPPED'} /> <span className="text-slate-500">{providers.sms.provider}</span></div>
          </div>
        </div>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Inbox</h2>
          <div className="flex flex-wrap gap-2">
            <form action={markAllReadAction}><button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">Mark all read</button></form>
            <form className="flex gap-2">
              <select name="category" defaultValue={category} className={inputClass}>
                <option value="">All categories</option>
                {NOTIFICATION_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
              <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white">Filter</button>
            </form>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {notifications.rows.map((notification) => (
            <div key={notification.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{notification.title}</span>
                  <StatusBadge status={notification.isRead ? 'READ' : 'UNREAD'} />
                  <span className="text-[11px] text-slate-500">{notification.category}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{notification.message}</p>
                <p className="mt-1 text-[11px] text-slate-400">{notification.createdAt.toISOString().replace('T', ' ').slice(0, 19)}</p>
              </div>
              <div className="flex gap-2">
                {!notification.isRead && (
                  <form action={markReadAction}>
                    <input type="hidden" name="id" value={notification.id} />
                    <button type="submit" className="text-xs font-semibold text-blue-600 hover:underline">Mark read</button>
                  </form>
                )}
                {!notification.archivedAt && (
                  <form action={archiveNotificationAction}>
                    <input type="hidden" name="id" value={notification.id} />
                    <button type="submit" className="text-xs font-semibold text-slate-500 hover:underline">Archive</button>
                  </form>
                )}
                {notification.actionUrl && <a href={notification.actionUrl} className="text-xs font-semibold text-blue-600 hover:underline">Open</a>}
              </div>
            </div>
          ))}
          {notifications.rows.length === 0 && <p className="py-4 text-sm text-slate-500">Your inbox is empty.</p>}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Page {notifications.page} of {notifications.pageCount} · {notifications.total} notifications · <a className="text-blue-600" href={showArchived ? '/notifications' : '/notifications?archived=1'}>{showArchived ? 'Hide archived' : 'Show archived'}</a>
        </p>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Preferences</h2>
        <p className="text-xs text-slate-500 mb-4">
          Security notifications are always delivered in-app when your organization enforces them. Email and SMS require configured providers.
        </p>
        <form action={savePreferencesAction}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>
                <th className={thClass}>Category</th><th className={thClass}>In-App</th><th className={thClass}>Email</th><th className={thClass}>SMS</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {preferences.map((preference) => (
                  <tr key={preference.category}>
                    <td className="py-2 pr-3 font-medium">{preference.category}</td>
                    <td><input type="checkbox" name={`inApp_${preference.category}`} defaultChecked={preference.inAppEnabled} className="h-4 w-4" /></td>
                    <td><input type="checkbox" name={`email_${preference.category}`} defaultChecked={preference.emailEnabled} className="h-4 w-4" /></td>
                    <td><input type="checkbox" name={`sms_${preference.category}`} defaultChecked={preference.smsEnabled} className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit" className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Save Preferences</button>
        </form>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <form action={testNotificationChannelAction}>
            <input type="hidden" name="channel" value="EMAIL" />
            <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">Test Email</button>
          </form>
          <form action={testNotificationChannelAction}>
            <input type="hidden" name="channel" value="SMS" />
            <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">Test SMS</button>
          </form>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Recent Delivery Attempts</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>
              <th className={thClass}>Channel</th><th className={thClass}>Destination</th><th className={thClass}>Status</th>
              <th className={thClass}>Provider</th><th className={thClass}>Attempts</th><th className={thClass}>Last Error</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td className="py-2 pr-3">{delivery.channel}</td>
                  <td className="py-2 pr-3">{delivery.destination}</td>
                  <td className="py-2 pr-3"><StatusBadge status={delivery.status} /></td>
                  <td className="py-2 pr-3">{delivery.provider ?? '—'}</td>
                  <td className="py-2 pr-3">{delivery.attempts}</td>
                  <td className="py-2 pr-3 text-slate-600">{delivery.lastError ?? '—'}</td>
                </tr>
              ))}
              {deliveries.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-500">No delivery attempts recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
