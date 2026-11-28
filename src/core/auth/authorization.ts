import type { Permission, TenantSession } from '@/core/types';
import { AuthorizationError } from '@/core/errors';
import { hasPermission } from '@/lib/permissions';
import { getOptionalTenantSession } from './session';

export const RESOURCE_ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  EXPORT: 'export',
  IMPORT: 'import',
  MANAGE: 'manage',
} as const;

export type ResourceAction = (typeof RESOURCE_ACTIONS)[keyof typeof RESOURCE_ACTIONS];

/**
 * Centralized server-side authorization. Every sensitive Server Action, API
 * route, and background operation should call one of these helpers instead of
 * trusting a client-supplied flag.
 */
export async function requireActionPermission(
  permission: Permission,
): Promise<TenantSession> {
  const tenant = await getOptionalTenantSession();
  if (!tenant) {
    throw new AuthorizationError('Your session is no longer valid. Please sign in again.');
  }
  if (!hasPermission(tenant.authorization, permission)) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
  return tenant;
}

export async function requireAnyActionPermission(
  permissions: readonly Permission[],
): Promise<TenantSession> {
  const tenant = await getOptionalTenantSession();
  if (!tenant) {
    throw new AuthorizationError('Your session is no longer valid. Please sign in again.');
  }
  if (!permissions.some((permission) => hasPermission(tenant.authorization, permission))) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
  return tenant;
}

export async function requireResourceAction(
  resource: string,
  action: ResourceAction,
): Promise<TenantSession> {
  const permission = `${resource}.${action}` as Permission;
  return requireActionPermission(permission);
}

export function can(
  tenant: Pick<TenantSession, 'authorization'> | null | undefined,
  permission: Permission,
): boolean {
  return Boolean(tenant && hasPermission(tenant.authorization, permission));
}

export function canAny(
  tenant: Pick<TenantSession, 'authorization'> | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return Boolean(
    tenant && permissions.some((permission) => hasPermission(tenant.authorization, permission)),
  );
}
