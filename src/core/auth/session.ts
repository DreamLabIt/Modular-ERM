import { auth } from './auth';
import { redirect } from 'next/navigation';
import type { TenantSession } from '@/core/types';
import { findTenantOrganization } from './model';

export type { TenantSession } from '@/core/types';

/**
 * Resolves a tenant session without issuing a redirect. Returns null when the
 * session is missing, inactive, or the organization is no longer available.
 */
export async function getOptionalTenantSession(): Promise<TenantSession | null> {
  const session = await auth();
  if (!session?.user) return null;

  const user = session.user;
  if (
    !user.id ||
    !user.organizationId ||
    !user.roleId ||
    !user.roleName ||
    !user.userIsActive ||
    !user.roleIsActive ||
    !user.organizationIsActive
  ) {
    return null;
  }

  const organization = await findTenantOrganization(user.organizationId);
  if (!organization?.isActive) return null;

  return {
    userId: user.id,
    name: user.name ?? '',
    email: user.email ?? '',
    roleId: user.roleId,
    roleName: user.roleName,
    organizationId: user.organizationId,
    authorization: {
      permissions: user.permissions,
      userIsActive: user.userIsActive,
      roleIsActive: user.roleIsActive,
      organizationIsActive: user.organizationIsActive,
    },
    authorizationVersion: user.authorizationVersion,
    organization: {
      id: organization.id,
      name: organization.name,
      logoUrl: organization.logoUrl,
      primaryColor: organization.primaryColor,
      currency: organization.currency,
      plan: organization.plan,
    },
    enabledModules: organization.modules.map((module) => module.moduleKey),
  };
}

export async function getRequiredTenantSession(): Promise<TenantSession> {
  const tenant = await getOptionalTenantSession();
  if (!tenant) redirect('/login');
  return tenant;
}
