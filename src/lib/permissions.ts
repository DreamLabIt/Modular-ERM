import {
  PERMISSION_KEYS,
  ROLE_PERMISSIONS,
  type AuthenticatedRole,
  type PermissionContext,
} from '@/core/types';

export { PERMISSION_KEYS, ROLE_PERMISSIONS, ROLES } from '@/core/types';
export type {
  AuthenticatedRole,
  Permission,
  PermissionGrant,
  PermissionContext,
  Role,
} from '@/core/types';

const knownPermissions = new Set<string>(PERMISSION_KEYS);

export function getUserPermissions(
  permissions: unknown,
  active: Pick<
    PermissionContext,
    'userIsActive' | 'roleIsActive' | 'organizationIsActive'
  >,
): string[] {
  if (
    !active.userIsActive ||
    !active.roleIsActive ||
    !active.organizationIsActive ||
    !Array.isArray(permissions)
  ) {
    return [];
  }

  return permissions.filter(
    (permission): permission is string =>
      typeof permission === 'string' &&
      (permission === '*' || knownPermissions.has(permission)),
  );
}

export function hasPermission(
  principal: AuthenticatedRole | PermissionContext | null | undefined,
  requiredPermission: string,
): boolean {
  if (
    !principal ||
    !principal.userIsActive ||
    !principal.roleIsActive ||
    !principal.organizationIsActive ||
    !knownPermissions.has(requiredPermission)
  ) {
    return false;
  }

  const permissions = getUserPermissions(principal.permissions, principal);
  return permissions.includes('*') || permissions.includes(requiredPermission);
}

export function canDelegatePermissions(
  principal: AuthenticatedRole | PermissionContext | null | undefined,
  requestedPermissions: readonly string[],
): boolean {
  if (
    !principal ||
    !principal.userIsActive ||
    !principal.roleIsActive ||
    !principal.organizationIsActive
  ) {
    return false;
  }

  const permissionsToDelegate = requestedPermissions.flatMap((permission) =>
    permission === '*' ? PERMISSION_KEYS : [permission],
  );
  const currentPermissions = getUserPermissions(principal.permissions, principal);
  if (currentPermissions.includes('*')) {
    return permissionsToDelegate.every((permission) =>
      knownPermissions.has(permission),
    );
  }

  return permissionsToDelegate.every(
    (permission) =>
      knownPermissions.has(permission) && currentPermissions.includes(permission),
  );
}

export function canDelegateRolePermissionChanges(
  principal: AuthenticatedRole | PermissionContext | null | undefined,
  existingPermissions: readonly string[],
  requestedPermissions: readonly string[],
): boolean {
  const previouslyGranted: readonly string[] = existingPermissions.includes('*')
    ? PERMISSION_KEYS
    : existingPermissions;
  const additions = requestedPermissions.filter(
    (permission) => !previouslyGranted.includes(permission),
  );
  return canDelegatePermissions(principal, additions);
}
