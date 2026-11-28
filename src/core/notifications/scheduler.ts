import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { createNotification, notifyRole } from './service';

export interface ScheduleNotificationInput {
  organizationId: string;
  userId?: string | null;
  roleId?: string | null;
  type: string;
  category?: string;
  dedupeKey: string;
  runAt: Date;
  title: string;
  message: string;
  actionUrl?: string;
  resourceType?: string;
  resourceId?: string;
}

export async function scheduleNotification(input: ScheduleNotificationInput) {
  return prisma.notificationJob.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {
      runAt: input.runAt,
      payload: {
        title: input.title,
        message: input.message,
        actionUrl: input.actionUrl ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        roleId: input.roleId ?? null,
        category: input.category ?? 'REMINDER',
      },
    },
    create: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      type: input.type,
      category: input.category ?? 'REMINDER',
      dedupeKey: input.dedupeKey,
      runAt: input.runAt,
      payload: {
        title: input.title,
        message: input.message,
        actionUrl: input.actionUrl ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        roleId: input.roleId ?? null,
        category: input.category ?? 'REMINDER',
      },
    },
  });
}

interface ReminderPayload {
  title?: string;
  message?: string;
  actionUrl?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  roleId?: string | null;
  category?: string;
}

/**
 * Durable scheduled-reminder worker. Called by the authenticated cron endpoint.
 * Jobs are claimed atomically so two instances cannot process the same job.
 */
export async function processDueNotificationJobs(limit = 50) {
  const due = await prisma.notificationJob.findMany({
    where: { status: 'PENDING', runAt: { lte: new Date() } },
    orderBy: { runAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  let failed = 0;

  for (const job of due) {
    const claimed = await prisma.notificationJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;

    try {
      const payload = (job.payload ?? {}) as ReminderPayload;
      if (payload.roleId) {
        await notifyRole({
          organizationId: job.organizationId,
          roleId: payload.roleId,
          title: payload.title ?? 'Reminder',
          message: payload.message ?? 'You have a pending item.',
          category: (payload.category as never) ?? 'REMINDER',
          resourceType: payload.resourceType ?? undefined,
          resourceId: payload.resourceId ?? undefined,
          actionUrl: payload.actionUrl ?? undefined,
          channels: ['IN_APP', 'EMAIL'],
        });
      } else {
        await createNotification({
          organizationId: job.organizationId,
          userId: job.userId,
          title: payload.title ?? 'Reminder',
          message: payload.message ?? 'You have a pending item.',
          category: (payload.category as never) ?? 'REMINDER',
          type: 'ACTION_REQUIRED',
          resourceType: payload.resourceType ?? undefined,
          resourceId: payload.resourceId ?? undefined,
          actionUrl: payload.actionUrl ?? undefined,
          channels: ['IN_APP', 'EMAIL'],
        });
      }
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: 'DONE', lastError: null },
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      const attempts = job.attempts + 1;
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: {
          status: attempts >= 5 ? 'FAILED' : 'PENDING',
          lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
          runAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60 * 1000),
        },
      });
    }
  }

  return { processed, failed };
}

/**
 * Scans business data and enqueues durable reminder jobs. Idempotent thanks to
 * the unique dedupeKey, so running it repeatedly does not duplicate messages.
 */
export async function enqueueScheduledReminders(organizationId?: string) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const dayKey = now.toISOString().slice(0, 10);
  const organizations = organizationId
    ? [{ id: organizationId }]
    : await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });

  let scheduled = 0;

  for (const org of organizations) {
    const pendingSteps = await prisma.approvalRequestStep.findMany({
      where: {
        status: 'ACTIVE',
        request: { organizationId: org.id, status: 'PENDING' },
        OR: [{ dueAt: { lte: tomorrow } }, { dueAt: null }],
      },
      include: {
        request: { select: { id: true, title: true, requesterId: true, moduleKey: true } },
      },
      take: 200,
    });

    for (const step of pendingSteps) {
      await scheduleNotification({
        organizationId: org.id,
        userId: step.request.requesterId,
        roleId: step.approverRoleId,
        type: 'APPROVAL_DUE',
        category: 'APPROVAL',
        dedupeKey: `approval-due:${step.id}:${dayKey}`,
        runAt: now,
        title: 'Approval still pending',
        message: `"${step.request.title}" is waiting for approval at step "${step.name}".`,
        actionUrl: `/approvals/${step.request.id}`,
        resourceType: 'APPROVAL_REQUEST',
        resourceId: step.request.id,
      });
      scheduled += 1;
    }

    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        organizationId: org.id,
        status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        dueDate: { lt: now },
      },
      select: { id: true, invoiceNumber: true, dueDate: true, totalAmount: true },
      take: 200,
    });
    for (const invoice of overdueInvoices) {
      await scheduleNotification({
        organizationId: org.id,
        type: 'INVOICE_OVERDUE',
        category: 'SALES',
        dedupeKey: `invoice-overdue:${invoice.id}:${dayKey}`,
        runAt: now,
        title: 'Invoice overdue',
        message: `Invoice ${invoice.invoiceNumber} is past due.`,
        actionUrl: `/sales-purchase/invoices`,
        resourceType: 'INVOICE',
        resourceId: invoice.id,
      });
      scheduled += 1;
    }

    const lowStock = await prisma.stockItem.findMany({
      where: {
        organizationId: org.id,
        product: { status: 'ACTIVE', archivedAt: null },
      },
      include: { product: { select: { id: true, name: true, reorderLevel: true, sku: true } }, warehouse: { select: { name: true } } },
      take: 500,
    });
    for (const stock of lowStock) {
      if (stock.quantity > stock.product.reorderLevel) continue;
      await scheduleNotification({
        organizationId: org.id,
        type: 'LOW_STOCK',
        category: 'INVENTORY',
        dedupeKey: `low-stock:${stock.productId}:${stock.warehouseId}:${dayKey}`,
        runAt: now,
        title: 'Low stock alert',
        message: `${stock.product.name} (${stock.product.sku}) has ${stock.quantity} units in ${stock.warehouse.name}; reorder level is ${stock.product.reorderLevel}.`,
        actionUrl: '/inventory/products',
        resourceType: 'PRODUCT',
        resourceId: stock.productId,
      });
      scheduled += 1;
    }

    const tasks = await prisma.projectTask.findMany({
      where: {
        organizationId: org.id,
        status: { not: 'COMPLETED' },
        dueDate: { gte: now, lte: inThreeDays },
        assigneeEmployeeId: { not: null },
      },
      include: { assignee: { select: { userId: true, fullName: true } } },
      take: 200,
    });
    for (const task of tasks) {
      if (!task.assignee?.userId) continue;
      await scheduleNotification({
        organizationId: org.id,
        userId: task.assignee.userId,
        type: 'TASK_DUE',
        category: 'PROJECT',
        dedupeKey: `task-due:${task.id}:${dayKey}`,
        runAt: now,
        title: 'Task deadline approaching',
        message: `Task "${task.title}" is due soon.`,
        actionUrl: '/projects',
        resourceType: 'PROJECT_TASK',
        resourceId: task.id,
      });
      scheduled += 1;
    }
  }

  return { scheduled };
}

export async function cancelNotificationJob(dedupeKey: string) {
  return prisma.notificationJob.updateMany({
    where: { dedupeKey, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
}
