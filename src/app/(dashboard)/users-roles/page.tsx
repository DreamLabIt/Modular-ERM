import { requireModuleAccess } from '@/core/auth/module-guard';
import { MODULE_REGISTRY } from '@/core/modules/registry';
import { createRoleAction, createUserAction } from '@/modules/users_roles/actions';
import { listUsersAndRoles } from '@/modules/users_roles/model';

export default async function UsersAndRolesPage() {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.view');

  const [users, roles] = await listUsersAndRoles(tenant.organizationId);

  const allPermissions = Object.values(MODULE_REGISTRY).flatMap((m) => m.permissions);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">User & Role — Admin, Manager & Employee Permissions</h1>
        <p className="text-sm text-slate-500">Provision staff login accounts and customize role-based access permissions.</p>
      </div>

      {/* Add User & Create/Update Role */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Create Staff User Account</h2>
          <form action={createUserAction} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input name="name" placeholder="Full Name" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input name="email" type="email" placeholder="Email Address" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input name="password" type="password" placeholder="Temporary Password" required minLength={6} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select name="roleId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Assign Role (Admin/Manager/Employee)</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
              Create User
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Create / Customize Role Permissions</h2>
          <form action={createRoleAction} className="space-y-3">
            <input name="name" placeholder="Role Name (e.g. Manager, Accountant, HR)" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-32 overflow-y-auto p-2 border border-slate-200 rounded-lg">
              {allPermissions.map((perm) => (
                <label key={perm} className="flex items-center gap-1.5 text-xs text-slate-700">
                  <input type="checkbox" name="permissions" value={perm} className="rounded text-blue-600" />
                  <span>{perm}</span>
                </label>
              ))}
            </div>
            <button type="submit" className="rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 px-4 py-2">
              Save Role & Permissions
            </button>
          </form>
        </div>
      </div>

      {/* Users & Roles Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-semibold text-sm">Organization Users</div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2.5 font-medium">{u.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                      {u.role.name}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-semibold text-sm">Defined Roles & Permission Scope</div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Granted Permissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {roles.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-semibold text-slate-900">{r.name}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {r.permissions.includes('*') ? 'Full System Access (*)' : r.permissions.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
