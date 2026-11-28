'use server';

import { guardedAction } from '@/core/auth/action';
import {
  revokeSessionById,
  revokeUserSessions,
} from '@/core/security/sessions';
import { recordAuditLog } from '@/core/audit';

export async function revokeSessionAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'sessions.manage',
    revalidate: '/settings/security',
    redirectTo: '/settings/security',
    successMessage: 'Session revoked. The user will be signed out on their next request.',
  }, async (tenant) => {
    const sessionId = String(formData.get('sessionId') || '');
    const ok = await revokeSessionById(tenant.organizationId, sessionId, tenant.userId, 'REVOKED_BY_ADMIN');
    if (!ok) throw new Error('Session not found or already revoked.');
    await recordAuditLog({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'SESSION_REVOKED',
      resource: 'USER_SESSION',
      resourceId: sessionId,
      description: 'Administrator revoked an active session.',
    });
  });
}

export async function revokeAllUserSessionsAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'sessions.manage',
    revalidate: '/settings/security',
    redirectTo: '/settings/security',
    successMessage: 'All sessions for that user have been revoked.',
  }, async (tenant) => {
    const userId = String(formData.get('userId') || '');
    if (!userId) throw new Error('Choose a user.');
    const count = await revokeUserSessions(tenant.organizationId, userId, 'ADMIN_BULK_REVOKE');
    await recordAuditLog({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'SESSIONS_BULK_REVOKED',
      resource: 'USER',
      resourceId: userId,
      description: `Revoked ${count} active session(s).`,
    });
  });
}
