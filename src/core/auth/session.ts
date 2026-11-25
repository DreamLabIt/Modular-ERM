import { auth } from './auth';
import { redirect } from 'next/navigation';
import type { TenantSession } from '@/core/types';
import { findTenantOrganization } from './model';

export type { TenantSession } from '@/core/types';

export async function getRequiredTenantSession(): Promise<TenantSession> {
  const session = await auth();
  if (!session?.user) redirect("/login");

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
    redirect('/login');
  }
  const organization = await findTenantOrganization(user.organizationId);
  if (!organization?.isActive) redirect('/login');

  return {
    userId: user.id,
    name: user.name ?? '',
    email: user.email ?? '',
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
