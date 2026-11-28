import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { getOrganizationSettings } from '@/core/settings';
import { getEmailProvider, isEmailConfigured } from './providers/email';
import { getSmsProvider, isSmsConfigured, isValidPhoneNumber } from './providers/sms';
import type { RenderedEmail } from './templates';

type DbClient = Prisma.TransactionClient | PrismaClient;

export const NOTIFICATION_CATEGORIES = [
  'SYSTEM',
  'SECURITY',
  'APPROVAL',
  'HRM',
  'PAYROLL',
  'ACCOUNTING',
  'INVENTORY',
  'SALES',
  'PROJECT',
  'REMINDER',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS';

export interface CreateNotificationInput {
  organizationId: string;
  userId?: string | null;
  type?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'ACTION_REQUIRED';
  category?: NotificationCategory;
  title: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
  actionUrl?: string | null;
  metadata?: Prisma.InputJsonValue;
  channels?: NotificationChannel[];
  email?: RenderedEmail;
  smsBody?: string;
  /** When false, delivery rows are queued for the background worker. */
  deliverNow?: boolean;
  db?: DbClient;
}

export interface NotificationPreferenceValues {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferenceValues = {
  inAppEnabled: true,
  emailEnabled: true,
  smsEnabled: false,
};

export async function getNotificationPreference(
  organizationId: string,
  userId: string,
  category: NotificationCategory,
  db: DbClient = prisma,
): Promise<NotificationPreferenceValues> {
  const preference = await db.notificationPreference.findUnique({
    where: { organizationId_userId_category: { organizationId, userId, category } },
  });
  return preference
    ? {
        inAppEnabled: preference.inAppEnabled,
        emailEnabled: preference.emailEnabled,
        smsEnabled: preference.smsEnabled,
      }
    : DEFAULT_PREFERENCES;
}

export async function listNotificationPreferences(
  organizationId: string,
  userId: string,
) {
  const rows = await prisma.notificationPreference.findMany({
    where: { organizationId, userId },
  });
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  return NOTIFICATION_CATEGORIES.map((category) => {
    const row = byCategory.get(category);
    return {
      category,
      inAppEnabled: row?.inAppEnabled ?? DEFAULT_PREFERENCES.inAppEnabled,
      emailEnabled: row?.emailEnabled ?? DEFAULT_PREFERENCES.emailEnabled,
      smsEnabled: row?.smsEnabled ?? DEFAULT_PREFERENCES.smsEnabled,
    };
  });
}

export async function updateNotificationPreference(
  organizationId: string,
  userId: string,
  category: NotificationCategory,
  values: Partial<NotificationPreferenceValues>,
) {
  return prisma.notificationPreference.upsert({
    where: { organizationId_userId_category: { organizationId, userId, category } },
    update: {
      ...(values.inAppEnabled !== undefined ? { inAppEnabled: values.inAppEnabled } : {}),
      ...(values.emailEnabled !== undefined ? { emailEnabled: values.emailEnabled } : {}),
      ...(values.smsEnabled !== undefined ? { smsEnabled: values.smsEnabled } : {}),
    },
    create: {
      organizationId,
      userId,
      category,
      inAppEnabled: values.inAppEnabled ?? DEFAULT_PREFERENCES.inAppEnabled,
      emailEnabled: values.emailEnabled ?? DEFAULT_PREFERENCES.emailEnabled,
      smsEnabled: values.smsEnabled ?? DEFAULT_PREFERENCES.smsEnabled,
    },
  });
}

/**
 * Creates an in-app notification and, where enabled, queues/sends email and SMS.
 * Provider failures are recorded and never reported as successful delivery.
 */
export async function createNotification(input: CreateNotificationInput) {
  const db = input.db ?? prisma;
  const category = input.category ?? 'SYSTEM';
  const requestedChannels = new Set<NotificationChannel>(
    input.channels ?? (input.userId ? ['IN_APP', 'EMAIL'] : ['IN_APP']),
  );

  const user = input.userId
    ? await db.user.findFirst({
        where: { id: input.userId, organizationId: input.organizationId },
        select: { id: true, email: true, phone: true, isActive: true },
      })
    : null;
  if (input.userId && !user) return null;

  const settings = await getOrganizationSettings(input.organizationId, db);
  const preferences = user
    ? await getNotificationPreference(input.organizationId, user.id, category, db)
    : DEFAULT_PREFERENCES;

  const securityMandatory =
    category === 'SECURITY' && settings.enforceSecurityNotifications;

  const inAppEnabled = securityMandatory || !user || preferences.inAppEnabled;
  const emailEnabled = user
    ? (securityMandatory || preferences.emailEnabled) && requestedChannels.has('EMAIL')
    : false;
  const smsEnabled = user
    ? preferences.smsEnabled && requestedChannels.has('SMS') && Boolean(user.phone)
    : false;

  let notification: { id: string } | null = null;
  if (inAppEnabled) {
    notification = await db.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: user?.id ?? null,
        type: input.type ?? 'INFO',
        category,
        title: input.title.slice(0, 200),
        message: input.message.slice(0, 4000),
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        actionUrl: input.actionUrl ?? null,
        link: input.actionUrl ?? null,
        metadata: input.metadata,
      },
      select: { id: true },
    });
  }

  const emailContent: RenderedEmail =
    input.email ?? {
      subject: input.title,
      text: input.message,
      html: `<p>${input.message.replace(
        /[<>&]/g,
        (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char] ?? char),
      )}</p>`,
    };

  const deliveryIds: string[] = [];
  if (emailEnabled && user?.email) {
    const delivery = await db.notificationDelivery.create({
      data: {
        organizationId: input.organizationId,
        notificationId: notification?.id ?? null,
        userId: user.id,
        channel: 'EMAIL',
        destination: user.email,
        status: 'PENDING',
        subject: emailContent.subject,
        body: emailContent.html,
        nextAttemptAt: new Date(),
      },
      select: { id: true },
    });
    deliveryIds.push(delivery.id);
  }

  if (smsEnabled && user?.phone && isValidPhoneNumber(user.phone)) {
    const delivery = await db.notificationDelivery.create({
      data: {
        organizationId: input.organizationId,
        notificationId: notification?.id ?? null,
        userId: user.id,
        channel: 'SMS',
        destination: user.phone,
        status: 'PENDING',
        body: (input.smsBody ?? input.message).slice(0, 1600),
        nextAttemptAt: new Date(),
      },
      select: { id: true },
    });
    deliveryIds.push(delivery.id);
  }

  if (input.deliverNow !== false && db === prisma) {
    await Promise.allSettled(deliveryIds.map((id) => deliverNotificationDelivery(id)));
  }

  return notification;
}

export async function deliverNotificationDelivery(deliveryId: string): Promise<boolean> {
  const delivery = await prisma.notificationDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.status === 'SENT' || delivery.status === 'SKIPPED') return false;

  try {
    if (delivery.channel === 'EMAIL') {
      const provider = getEmailProvider();
      if (!provider.isConfigured()) {
        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SKIPPED',
            provider: provider.name,
            lastError: 'Email provider is not configured.',
            attempts: { increment: 1 },
            nextAttemptAt: null,
          },
        });
        return false;
      }
      const result = await provider.send({
        to: delivery.destination,
        email: {
          subject: delivery.subject ?? 'Notification',
          html: delivery.body ?? '',
          text: (delivery.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        },
      });
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SENT',
          provider: result.provider,
          sentAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
          nextAttemptAt: null,
        },
      });
      return true;
    }

    if (delivery.channel === 'SMS') {
      const provider = getSmsProvider();
      if (!provider.isConfigured()) {
        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SKIPPED',
            provider: provider.name,
            lastError: 'SMS provider is not configured.',
            attempts: { increment: 1 },
            nextAttemptAt: null,
          },
        });
        return false;
      }
      const result = await provider.send({ to: delivery.destination, body: delivery.body ?? '' });
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SENT',
          provider: result.provider,
          sentAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
          nextAttemptAt: null,
        },
      });
      return true;
    }

    return false;
  } catch (error) {
    const attempts = delivery.attempts + 1;
    const backoffMinutes = Math.min(60, 2 ** attempts);
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: attempts >= 5 ? 'FAILED' : 'PENDING',
        attempts,
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown delivery error',
        nextAttemptAt: attempts >= 5 ? null : new Date(Date.now() + backoffMinutes * 60 * 1000),
      },
    });
    return false;
  }
}

export async function processPendingDeliveries(limit = 50) {
  const due = await prisma.notificationDelivery.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  let sent = 0;
  for (const delivery of due) {
    if (await deliverNotificationDelivery(delivery.id)) sent += 1;
  }
  return { processed: due.length, sent };
}

export async function notifyRole(input: {
  organizationId: string;
  roleId: string;
  title: string;
  message: string;
  category?: NotificationCategory;
  type?: CreateNotificationInput['type'];
  resourceType?: string;
  resourceId?: string;
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
  channels?: NotificationChannel[];
}) {
  const users = await prisma.user.findMany({
    where: { organizationId: input.organizationId, roleId: input.roleId, isActive: true },
    select: { id: true },
  });
  for (const user of users) {
    await createNotification({
      ...input,
      userId: user.id,
      channels: input.channels ?? ['IN_APP', 'EMAIL'],
    });
  }
  return users.length;
}

export interface NotificationSearchInput {
  organizationId: string;
  userId: string;
  page?: number;
  pageSize?: number;
  category?: string;
  unreadOnly?: boolean;
  includeArchived?: boolean;
}

export async function searchNotifications(input: NotificationSearchInput) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize ?? 20));
  const where: Prisma.NotificationWhereInput = {
    organizationId: input.organizationId,
    userId: input.userId,
    ...(input.includeArchived ? {} : { archivedAt: null }),
    ...(input.category ? { category: input.category } : {}),
    ...(input.unreadOnly ? { isRead: false } : {}),
  };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: { organizationId: input.organizationId, userId: input.userId, isRead: false, archivedAt: null },
    }),
  ]);
  return { rows, total, unread, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getUnreadNotificationCount(organizationId: string, userId: string) {
  return prisma.notification.count({
    where: { organizationId, userId, isRead: false, archivedAt: null },
  });
}

export async function markNotificationRead(organizationId: string, userId: string, id: string) {
  return prisma.notification.updateMany({
    where: { id, organizationId, userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function markAllNotificationsRead(organizationId: string, userId: string) {
  return prisma.notification.updateMany({
    where: { organizationId, userId, isRead: false, archivedAt: null },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function archiveNotification(organizationId: string, userId: string, id: string) {
  return prisma.notification.updateMany({
    where: { id, organizationId, userId },
    data: { archivedAt: new Date(), isRead: true, readAt: new Date() },
  });
}

export function notificationProviderStatus() {
  return {
    email: { configured: isEmailConfigured(), provider: process.env.EMAIL_PROVIDER || 'none' },
    sms: { configured: isSmsConfigured(), provider: process.env.SMS_PROVIDER || 'none' },
  };
}
