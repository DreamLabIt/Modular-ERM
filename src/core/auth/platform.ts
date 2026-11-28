import { redirect } from 'next/navigation';
import { auth } from './auth';
import { platformAudit } from '@/core/billing/audit';

export interface PlatformIdentity {
  id: string;
  email: string;
  name: string;
}

/** Pure identity check used by the guard; organization roles never satisfy it. */
export function isPlatformIdentity(value: unknown): value is PlatformIdentity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.isPlatformAdmin === true &&
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.email === 'string' &&
    candidate.email.length > 0 &&
    candidate.userIsActive === true
  );
}

/**
 * Resolves a platform super admin from the dedicated NextAuth provider.
 * Organization-scoped roles can never satisfy this check.
 */
export async function getOptionalPlatformAdmin(): Promise<PlatformIdentity | null> {
  const session = await auth();
  const user = session?.user;
  if (!isPlatformIdentity(user)) return null;
  return { id: user.id, email: user.email, name: user.name ?? user.email };
}

export async function requirePlatformAdmin(): Promise<PlatformIdentity> {
  const admin = await getOptionalPlatformAdmin();
  if (!admin) redirect('/platform-admin/login');
  return admin;
}

/** Non-redirecting variant for server actions and API routes. */
export async function assertPlatformAdmin(): Promise<PlatformIdentity> {
  const admin = await getOptionalPlatformAdmin();
  if (!admin) throw new Error('Platform Super Admin authorization required.');
  return admin;
}

export async function recordPlatformAction(
  admin: PlatformIdentity,
  action: string,
  resource: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
) {
  await platformAudit({
    actor: admin,
    action,
    resource,
    resourceId,
    metadata,
  });
}
