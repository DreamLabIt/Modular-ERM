'use server';

import { guardedAction } from '@/core/auth/action';
import { ValidationError } from '@/core/errors';
import {
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotification,
  updateNotificationPreference,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '@/core/notifications/service';

export async function markReadAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'notifications.view',
    revalidate: ['/notifications', '/dashboard'],
  }, async (tenant) => {
    await markNotificationRead(tenant.organizationId, tenant.userId, String(formData.get('id') || ''));
  });
}

export async function markAllReadAction(): Promise<void> {
  await guardedAction({
    permission: 'notifications.view',
    revalidate: ['/notifications', '/dashboard'],
  }, async (tenant) => {
    await markAllNotificationsRead(tenant.organizationId, tenant.userId);
  });
}

export async function archiveNotificationAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'notifications.view',
    revalidate: ['/notifications', '/dashboard'],
  }, async (tenant) => {
    await archiveNotification(tenant.organizationId, tenant.userId, String(formData.get('id') || ''));
  });
}

export async function savePreferencesAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'notifications.preferences.manage',
    revalidate: '/notifications',
    redirectTo: '/notifications',
    successMessage: 'Notification preferences saved.',
  }, async (tenant) => {
    for (const category of NOTIFICATION_CATEGORIES) {
      await updateNotificationPreference(tenant.organizationId, tenant.userId, category as NotificationCategory, {
        inAppEnabled: formData.get(`inApp_${category}`) === 'on',
        emailEnabled: formData.get(`email_${category}`) === 'on',
        smsEnabled: formData.get(`sms_${category}`) === 'on',
      });
    }
  });
}

export async function testNotificationChannelAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'notifications.preferences.manage',
    revalidate: '/notifications',
    redirectTo: '/notifications',
    successMessage: 'Test notification queued. Delivery status is shown below.',
  }, async (tenant) => {
    const channel = String(formData.get('channel') || '');
    if (!['EMAIL', 'SMS'].includes(channel)) {
      throw new ValidationError('Choose a supported test channel.');
    }
    const { createNotification, deliverNotificationDelivery } = await import('@/core/notifications/service');
    const { prisma } = await import('@/core/db/prisma');
    const user = await prisma.user.findFirst({
      where: { id: tenant.userId, organizationId: tenant.organizationId },
      select: { id: true, email: true, phone: true },
    });
    if (!user) throw new ValidationError('Your user account was not found.');
    const destination = channel === 'EMAIL' ? user.email : user.phone;
    if (!destination) throw new ValidationError('No destination is configured on your profile.');

    const notification = await createNotification({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      category: 'SYSTEM',
      type: 'INFO',
      title: 'Test notification',
      message: 'This is a test notification from your ERM workspace.',
      channels: [channel as 'EMAIL' | 'SMS'],
      deliverNow: false,
    });
    if (!notification) throw new ValidationError('Notification could not be created.');
    const delivery = await prisma.notificationDelivery.findFirst({
      where: {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        notificationId: notification.id,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!delivery) {
      throw new ValidationError(
        'No delivery was queued. Check your notification preferences and provider configuration.',
      );
    }
    await deliverNotificationDelivery(delivery.id);
    const status = await prisma.notificationDelivery.findUnique({
      where: { id: delivery.id },
      select: { status: true, lastError: true },
    });
    if (status?.status !== 'SENT') {
      throw new ValidationError(
        status?.status === 'SKIPPED'
          ? 'Delivery was skipped because the provider is not configured. Configure it to enable real delivery.'
          : `Delivery failed: ${status?.lastError ?? 'unknown error'}`,
      );
    }
  });
}
