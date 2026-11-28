import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { runBillingJobs } from '@/core/billing/jobs';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  dryRun: z.enum(['1', 'true']).optional(),
});

/** Secure scheduled billing processor. Requires Authorization: Bearer $CRON_SECRET. */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: 'Billing cron is not configured.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters.' }, { status: 400 });
  }

  try {
    if (parsed.data.dryRun) {
      return NextResponse.json({ dryRun: true, message: 'Dry-run requested; no mutation performed.' });
    }
    const result = await runBillingJobs();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[billing-cron] failed', error);
    return NextResponse.json({ error: 'Billing job failed.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
