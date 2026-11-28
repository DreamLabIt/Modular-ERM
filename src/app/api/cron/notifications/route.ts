import { NextResponse, type NextRequest } from 'next/server';
import { processDueNotificationJobs, enqueueScheduledReminders } from '@/core/notifications/scheduler';
import { processPendingDeliveries } from '@/core/notifications/service';
import { purgeExpiredExports } from '@/core/data/export';
import { purgeExpiredSessions } from '@/core/security/sessions';
import { prisma } from '@/core/db/prisma';

export const dynamic = 'force-dynamic';

/**
 * Durable background worker endpoint. Invoke from a scheduler (Vercel Cron,
 * systemd timer, or an external cron job) with:
 *
 *   Authorization: Bearer $CRON_SECRET
 *
 * Without CRON_SECRET the endpoint is disabled, so it cannot be triggered by
 * an anonymous caller.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: 'Cron worker is not configured.' }, { status: 503 });
  }
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const startedAt = new Date();
  const organizationId = request.nextUrl.searchParams.get('organizationId') ?? undefined;
  if (organizationId && !/^[a-zA-Z0-9_-]{1,64}$/.test(organizationId)) {
    return NextResponse.json({ error: 'Invalid organization id.' }, { status: 400 });
  }

  try {
    const reminders = await enqueueScheduledReminders(organizationId);
    const jobs = await processDueNotificationJobs(100);
    const deliveries = await processPendingDeliveries(100);
    const expiredExports = await purgeExpiredExports();
    const expiredSessions = await purgeExpiredSessions(60);

    await prisma.notificationJob.deleteMany({
      where: {
        status: { in: ['DONE', 'CANCELLED'] },
        createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });

    return NextResponse.json({
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      reminders,
      jobs,
      deliveries,
      expiredExports,
      expiredSessions: expiredSessions.count,
    });
  } catch (error) {
    console.error('[cron] notification worker failed', error);
    return NextResponse.json({ error: 'Background worker failed.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
