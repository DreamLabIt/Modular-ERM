import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/core/auth/auth';
import { getInvoiceForOrganization, buildInvoicePdf } from '@/core/billing/invoices';
import { recordAuditLog } from '@/core/audit';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().min(1) });

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid invoice id.' }, { status: 400 });
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.organizationId || !user.userIsActive) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const invoice = await getInvoiceForOrganization(user.organizationId, parsed.data.id);
    const pdf = buildInvoicePdf(invoice, user.organizationId);
    await recordAuditLog({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'BILLING_INVOICE_DOWNLOADED',
      resource: 'BILLING_INVOICE',
      resourceId: invoice.id,
    });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
}
