import {
  ROLE_PERMISSIONS,
  type AuthenticatedRole,
  type Permission,
  type Role,
} from '@/core/types';

export { PERMISSION_KEYS, ROLE_PERMISSIONS, ROLES } from '@/core/types';
export type { AuthenticatedRole, Permission, PermissionGrant, Role } from '@/core/types';

function isBuiltInRole(roleName: string): roleName is Role {
  return Object.hasOwn(ROLE_PERMISSIONS, roleName);
}

export function hasPermission(
  userRole: Role | AuthenticatedRole,
  requiredPermission: Permission,
): boolean {
  const permissions =
    typeof userRole === 'string'
      ? ROLE_PERMISSIONS[userRole]
      : isBuiltInRole(userRole.roleName)
        ? ROLE_PERMISSIONS[userRole.roleName]
        : userRole.permissions;

  return permissions.includes('*') || permissions.includes(requiredPermission);
}
