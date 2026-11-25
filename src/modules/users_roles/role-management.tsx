'use client';

import { useState, type FormEvent } from 'react';
import {
  PERMISSION_KEYS,
  type ManagedRole,
  type ManagedUser,
  type PermissionGroup,
  type RoleManagementProps,
  type RoleMutationResult,
} from '@/core/types';
import {
  createRoleAction,
  createUserAction,
  deleteRoleAction,
  setRoleActiveAction,
  updateRoleAction,
  updateUserRoleAction,
} from './actions';

function ResultMessage({
  result,
}: {
  result: RoleMutationResult | null;
}) {
  if (!result) return null;
  return (
    <p
      role={result.success ? 'status' : 'alert'}
      className={`mt-2 text-xs ${
        result.success ? 'text-emerald-700' : 'text-red-700'
      }`}
    >
      {result.success ? 'Saved successfully.' : result.error}
    </p>
  );
}

function RoleEditor({
  role,
  permissionGroups,
}: {
  role?: ManagedRole;
  permissionGroups: PermissionGroup[];
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [permissions, setPermissions] = useState<string[]>(() => {
    if (!role) return [];
    return PERMISSION_KEYS.filter(
      (permission) =>
        role.permissions.includes('*') || role.permissions.includes(permission),
    );
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RoleMutationResult | null>(null);

  function togglePermission(permission: string, checked: boolean) {
    setPermissions((current) =>
      checked
        ? Array.from(new Set([...current, permission]))
        : current.filter((value) => value !== permission),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (role && !window.confirm(`Save permission changes for ${role.name}?`)) {
      return;
    }

    setPending(true);
    setResult(null);
    try {
      const response = role
        ? await updateRoleAction(role.id, name, permissions)
        : await createRoleAction(name, permissions);
      setResult(response);
    } catch {
      setResult({
        success: false,
        error: 'Could not save the role. Please try again.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-xs font-medium text-slate-600">
        Role name
        <input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
          maxLength={80}
          readOnly={role?.isSystem}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm read-only:bg-slate-100"
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">
          Permissions
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPermissions([...PERMISSION_KEYS])}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setPermissions([])}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Clear all
          </button>
        </div>
      </div>

      <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
        {permissionGroups.map((group) => (
          <fieldset key={group.label}>
            <legend className="mb-1 text-xs font-semibold text-slate-800">
              {group.label}
            </legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {group.permissions.map((permission) => (
                <label
                  key={permission}
                  className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={permissions.includes(permission)}
                    onChange={(event) =>
                      togglePermission(permission, event.currentTarget.checked)
                    }
                    className="rounded text-blue-600 focus:ring-[var(--focus-ring)]"
                  />
                  <span className="break-all">{permission}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <button
        type="submit"
        disabled={pending || (role ? !role.isActive : false)}
        className="rounded-lg bg-[var(--button-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--button-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : role ? 'Save role' : 'Create role'}
      </button>
      {role && (
        <p className="text-[11px] text-slate-500">
          Authorization version: {role.authorizationVersion}
        </p>
      )}
      <ResultMessage result={result} />
    </form>
  );
}

function UserRoleRow({
  user,
  roles,
}: {
  user: ManagedUser;
  roles: ManagedRole[];
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RoleMutationResult | null>(null);
  const activeRoles = roles.filter((role) => role.isActive);

  async function handleRoleChange(roleId: string) {
    if (roleId === user.roleId || pending) return;
    if (!window.confirm(`Change ${user.name}'s role?`)) return;
    setPending(true);
    setResult(null);
    try {
      setResult(await updateUserRoleAction(user.id, roleId));
    } catch {
      setResult({
        success: false,
        error: 'Could not update the user role. Please try again.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <tr>
      <td className="px-3 py-3 font-medium text-slate-900">{user.name}</td>
      <td className="px-3 py-3 text-slate-600">{user.email}</td>
      <td className="px-3 py-3">
        <select
          value={user.roleId}
          disabled={pending}
          onChange={(event) => void handleRoleChange(event.currentTarget.value)}
          aria-label={`Role for ${user.name}`}
          className="max-w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs disabled:opacity-60"
        >
          {activeRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        {result && (
          <p
            role={result.success ? 'status' : 'alert'}
            className={`mt-1 text-[11px] ${
              result.success ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {result.success ? 'Updated.' : result.error}
          </p>
        )}
      </td>
    </tr>
  );
}

function RoleLifecycleActions({ role }: { role: ManagedRole }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RoleMutationResult | null>(null);

  async function setActive(active: boolean) {
    if (pending || !window.confirm(`${active ? 'Activate' : 'Deactivate'} ${role.name}?`)) {
      return;
    }
    setPending(true);
    setResult(null);
    try {
      setResult(await setRoleActiveAction(role.id, active));
    } catch {
      setResult({
        success: false,
        error: 'Could not update the role status. Please try again.',
      });
    } finally {
      setPending(false);
    }
  }

  async function removeRole() {
    if (pending || !window.confirm(`Permanently delete ${role.name}?`)) return;
    setPending(true);
    setResult(null);
    try {
      setResult(await deleteRoleAction(role.id));
    } catch {
      setResult({
        success: false,
        error: 'Could not delete the role. Please try again.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={
          pending ||
          role.isSystem ||
          (role.isActive && role.userCount > 0)
        }
        onClick={() => void setActive(!role.isActive)}
        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {role.isActive ? 'Deactivate' : 'Activate'}
      </button>
      <button
        type="button"
        disabled={pending || role.isSystem || role.userCount > 0}
        onClick={() => void removeRole()}
        className="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Delete
      </button>
      <span className="text-xs text-slate-500">
        {role.userCount} assigned user{role.userCount === 1 ? '' : 's'}
      </span>
      <ResultMessage result={result} />
    </div>
  );
}

export default function RoleManagement({
  roles,
  users,
  permissionGroups,
  canManage,
}: RoleManagementProps) {
  const [userPending, setUserPending] = useState(false);
  const [userResult, setUserResult] = useState<RoleMutationResult | null>(null);
  const activeRoles = roles.filter((role) => role.isActive);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (userPending) return;
    setUserPending(true);
    setUserResult(null);
    try {
      setUserResult(await createUserAction(new FormData(event.currentTarget)));
    } catch {
      setUserResult({
        success: false,
        error: 'Could not create the user. Please try again.',
      });
    } finally {
      setUserPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <section className="erp-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
              Create Staff User Account
            </h2>
            <form onSubmit={handleCreateUser} className="space-y-3">
              <input
                name="name"
                placeholder="Full name"
                required
                maxLength={120}
                className="erp-input"
              />
              <input
                name="email"
                type="email"
                placeholder="Email address"
                required
                maxLength={254}
                className="erp-input"
              />
              <input
                name="password"
                type="password"
                placeholder="Temporary password (8+ characters)"
                required
                minLength={8}
                maxLength={128}
                className="erp-input"
              />
              <select name="roleId" required className="erp-input">
                <option value="">Select role</option>
                {activeRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={userPending}
                className="erp-button-primary disabled:opacity-60"
              >
                {userPending ? 'Creating…' : 'Create user'}
              </button>
              <ResultMessage result={userResult} />
            </form>
          </section>

          <section className="erp-card p-5">
            <h2 className="mb-1 text-sm font-semibold text-[var(--foreground)]">
              Create Custom Role
            </h2>
            <p className="mb-4 text-xs text-[var(--text-secondary)]">
              You can only delegate permissions granted to your own account.
            </p>
            <RoleEditor permissionGroups={permissionGroups} />
          </section>
        </div>
      )}

      <section className="erp-card overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            Organization Users
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-[var(--background)] text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {users.map((user) => (
                canManage ? (
                  <UserRoleRow key={user.id} user={user} roles={roles} />
                ) : (
                  <tr key={user.id}>
                    <td className="px-3 py-3 font-medium">{user.name}</td>
                    <td className="px-3 py-3 text-slate-600">{user.email}</td>
                    <td className="px-3 py-3">{user.roleName}</td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-[var(--foreground)]">
            Roles &amp; Permission Matrix
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Effective permissions and authorization versions from organization roles.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {roles.map((role) => (
            <article key={role.id} className="erp-card min-w-0 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-[var(--foreground)]">
                    {role.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[var(--text-secondary)]">
                      {role.isSystem ? 'System role' : 'Custom role'}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        role.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {role.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </div>
              {canManage && role.isActive ? (
                <RoleEditor role={role} permissionGroups={permissionGroups} />
              ) : (
                <div className="space-y-3">
                  {permissionGroups.map((group) => {
                    const effectivePermissions = role.permissions.includes('*')
                      ? group.permissions
                      : group.permissions.filter((permission) =>
                          role.permissions.includes(permission),
                        );
                    return (
                      <div key={group.label}>
                        <h4 className="mb-1 text-xs font-semibold text-slate-700">
                          {group.label}
                        </h4>
                        <p className="break-words text-xs text-slate-600">
                          {effectivePermissions.length > 0
                            ? effectivePermissions.join(', ')
                            : 'No permissions'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              {canManage && !role.isSystem && (
                <RoleLifecycleActions role={role} />
              )}
              {!canManage && (
                <p className="mt-3 text-xs text-slate-500">
                  {role.userCount} assigned user{role.userCount === 1 ? '' : 's'}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
