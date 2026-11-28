import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/core/auth/auth';
import { downloadExportJob } from '@/core/data/export';
import { recordAuditLog } from '@/core/audit';
import { AppError } from '@/core/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  const user = session?.user;
  const token = request.nextUrl.searchParams.get('token') ?? '';

  if (!user?.id || !user.organizationId || !user.userIsActive || !token) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const { job, buffer } = await downloadExportJob({
      organizationId: user.organizationId,
      userId: user.id,
      token,
    });
    await recordAuditLog({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'EXPORT_DOWNLOADED',
      resource: 'EXPORT_JOB',
      resourceId: job.id,
      description: `Downloaded ${job.fileName}.`,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': job.format === 'CSV' ? 'text/csv; charset=utf-8' : job.format === 'PDF' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${job.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('[export] download failed', error);
    return NextResponse.json({ error: 'Download failed.' }, { status: 500 });
  }
}
