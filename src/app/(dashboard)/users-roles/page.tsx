import { requireModuleAccess } from '@/core/auth/module-guard';
import { MODULE_REGISTRY } from '@/core/modules/registry';
import { listUsersAndRoles } from '@/modules/users_roles/model';
import RoleManagement from '@/modules/users_roles/role-management';
import { hasPermission } from '@/lib/permissions';
import { PERMISSION_KEYS } from '@/core/types';

export default async function UsersAndRolesPage() {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.view');
  const [users, roles] = await listUsersAndRoles(tenant.organizationId);
  const permissionGroups = Object.values(MODULE_REGISTRY).map((module) => ({
    label: module.name,
    permissions: module.permissions,
  }));
  const groupedPermissions = new Set(
    permissionGroups.flatMap((group) => group.permissions),
  );
  const ungroupedPermissions = PERMISSION_KEYS.filter(
    (permission) => !groupedPermissions.has(permission),
  );
  if (ungroupedPermissions.length > 0) {
    permissionGroups.push({
      label: 'General',
      permissions: ungroupedPermissions,
    });
  }
  const canManage = hasPermission(tenant.authorization, 'users_roles.manage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">User & Role — Admin, Manager & Employee Permissions</h1>
        <p className="text-sm text-slate-500">
          Database-backed organization roles, permission delegation, and user assignments.
        </p>
      </div>
      <RoleManagement
        roles={roles}
        users={users}
        permissionGroups={permissionGroups}
        canManage={canManage}
      />
    </div>
  );
}
