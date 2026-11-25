import { redirect } from 'next/navigation';
import { getRequiredTenantSession } from './session';
import type { Permission } from '@/core/types';
import { hasPermission } from '@/lib/permissions';

export async function requirePermission(requiredPermission: Permission) {
  const tenant = await getRequiredTenantSession();

  if (!hasPermission({ roleName: tenant.roleName, permissions: tenant.permissions }, requiredPermission)) {
    redirect('/dashboard?error=unauthorized');
  }

  return tenant;
}

export async function requireModuleAccess(moduleKey: string, requiredPermission?: Permission) {
  const tenant = await getRequiredTenantSession();

  if (
    requiredPermission &&
    !hasPermission(
      { roleName: tenant.roleName, permissions: tenant.permissions },
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
