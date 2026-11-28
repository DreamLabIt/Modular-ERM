import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { processPaymentWebhook } from '@/core/billing/payments/service';
import { getPaymentProvider } from '@/core/billing/payments/providers';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ provider: z.string().min(1).max(40) });

export async function POST(
  request: NextRequest,
  { params }: { params: { provider: string } },
) {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid provider.' }, { status: 400 });

  const signature =
    request.headers.get('x-webhook-signature') ??
    request.headers.get('x-sslcommerz-signature') ??
    '';
  const rawBody = await request.text();
  if (!rawBody) return NextResponse.json({ error: 'Empty webhook body.' }, { status: 400 });

  try {
    // Fail fast for providers without a configured webhook secret.
    const provider = getPaymentProvider(parsed.data.provider);
    if (!provider.isConfigured() || !provider.parseWebhook) {
      return NextResponse.json({ error: 'Provider webhook is not configured.' }, { status: 503 });
    }
    const result = await processPaymentWebhook({
      provider: parsed.data.provider,
      rawBody,
      signature,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[billing-webhook] rejected', error);
    return NextResponse.json({ error: 'Webhook could not be verified or processed.' }, { status: 400 });
  }
}
