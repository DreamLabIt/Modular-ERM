'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireModuleAccess } from '@/core/auth/module-guard';
import {
  PERMISSION_KEYS,
  type RoleMutationResult,
} from '@/core/types';
import {
  createRole,
  createUser,
  deleteRole,
  setRoleActive,
  updateRole,
  updateUserRole,
} from './model';
import { revokeUserSessions } from '@/core/security/sessions';

const permissionSchema = z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length);
const roleIdSchema = z.string().trim().min(1).max(64);
const roleNameSchema = z.string().trim().min(1).max(80);

function getUniquePermissions(value: unknown) {
  const parsed = permissionSchema.safeParse(value);
  if (!parsed.success) return null;
  return Array.from(new Set(parsed.data));
}

function revalidateRoleManagement() {
  revalidatePath('/users-roles');
  revalidatePath('/dashboard');
}

export async function createRoleAction(
  name: string,
  submittedPermissions: string[],
): Promise<RoleMutationResult> {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.manage');
  const parsedName = roleNameSchema.safeParse(name);
  const permissions = getUniquePermissions(submittedPermissions);
  if (!parsedName.success || !permissions) {
    return { success: false, error: 'Enter a role name and choose valid permissions.' };
  }
  const result = await createRole({
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    actorAuthorization: tenant.authorization,
    name: parsedName.data,
    permissions,
  });
  if (result.success) revalidateRoleManagement();
  return result;
}

export async function updateRoleAction(
  roleId: string,
  name: string,
  submittedPermissions: string[],
): Promise<RoleMutationResult> {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.manage');
  const parsedId = roleIdSchema.safeParse(roleId);
  const parsedName = roleNameSchema.safeParse(name);
  const permissions = getUniquePermissions(submittedPermissions);
  if (!parsedId.success || !parsedName.success || !permissions) {
    return { success: false, error: 'Role details or permissions are invalid.' };
  }

  const result = await updateRole({
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    actorAuthorization: tenant.authorization,
    roleId: parsedId.data,
    name: parsedName.data,
    permissions,
  });
  if (result.success) revalidateRoleManagement();
  return result;
}

export async function setRoleActiveAction(
  roleId: string,
  isActive: boolean,
): Promise<RoleMutationResult> {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.manage');
  const parsedId = roleIdSchema.safeParse(roleId);
  if (!parsedId.success || typeof isActive !== 'boolean') {
    return { success: false, error: 'Role status update is invalid.' };
  }

  const result = await setRoleActive(
    tenant.organizationId,
    tenant.userId,
    parsedId.data,
    isActive,
  );
  if (result.success) revalidateRoleManagement();
  return result;
}

export async function deleteRoleAction(roleId: string): Promise<RoleMutationResult> {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.manage');
  const parsedId = roleIdSchema.safeParse(roleId);
  if (!parsedId.success) return { success: false, error: 'Role ID is invalid.' };

  const result = await deleteRole(
    tenant.organizationId,
    tenant.userId,
    parsedId.data,
  );
  if (result.success) revalidateRoleManagement();
  return result;
}

export async function createUserAction(
  formData: FormData,
): Promise<RoleMutationResult> {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.manage');
  const input = z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(254),
      password: z.string().min(8).max(128),
      roleId: roleIdSchema,
    })
    .safeParse({
      name: formData.get('name'),
      email: String(formData.get('email') || '').trim().toLowerCase(),
      password: formData.get('password'),
      roleId: formData.get('roleId'),
    });

  if (!input.success) {
    return { success: false, error: 'Enter valid user details and select a role.' };
  }

  const result = await createUser({
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    actorAuthorization: tenant.authorization,
    ...input.data,
  });
  if (result.success) revalidateRoleManagement();
  return result;
}

export async function updateUserRoleAction(
  userId: string,
  roleId: string,
): Promise<RoleMutationResult> {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.manage');
  const parsedUserId = roleIdSchema.safeParse(userId);
  const parsedRoleId = roleIdSchema.safeParse(roleId);
  if (!parsedUserId.success || !parsedRoleId.success) {
    return { success: false, error: 'User or role ID is invalid.' };
  }

  const result = await updateUserRole({
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    actorAuthorization: tenant.authorization,
    userId: parsedUserId.data,
    roleId: parsedRoleId.data,
  });
  if (result.success) {
    await revokeUserSessions(
      tenant.organizationId,
      parsedUserId.data,
      'ROLE_CHANGED',
    );
    revalidateRoleManagement();
  }
  return result;
}
