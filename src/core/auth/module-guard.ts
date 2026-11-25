import { redirect } from 'next/navigation';
import { getRequiredTenantSession } from './session';
import type { Permission, TenantSession } from '@/core/types';
import { hasPermission } from '@/lib/permissions';
import { AuthorizationError } from '@/core/errors';

export async function requirePermission(requiredPermission: Permission) {
  const tenant = await getRequiredTenantSession();

  if (!hasPermission(tenant.authorization, requiredPermission)) {
    redirect('/dashboard?error=unauthorized');
  }

  return tenant;
}

export async function requireModuleAccess(moduleKey: string, requiredPermission?: Permission) {
  const tenant = await getRequiredTenantSession();

  if (
    requiredPermission &&
    !hasPermission(
      tenant.authorization,
      requiredPermission,
    )
  ) {
    redirect('/dashboard?error=unauthorized');
  }

  if (!tenant.enabledModules.includes(moduleKey)) {
    redirect(`/upgrade?module=${moduleKey}`);
  }

  return tenant;
}

/**
 * Checks module & permission access for Server Actions and API handlers
 * without issuing a Next.js redirect, supporting multiple accepted permissions (OR).
 */
export async function assertActionAccess(
  moduleKey: string,
  requiredPermissions?: Permission | Permission[],
): Promise<TenantSession> {
  const tenant = await getRequiredTenantSession();
  if (!tenant.enabledModules.includes(moduleKey)) {
    throw new AuthorizationError(`Module "${moduleKey}" is not enabled for your organization.`);
  }
  if (requiredPermissions) {
    const list = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    const allowed = list.some((perm) => hasPermission(tenant.authorization, perm));
    if (!allowed) {
      throw new AuthorizationError('You do not have permission to perform this action.');
    }
  }
  return tenant;
}
