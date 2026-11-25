'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { createRole, createUser } from './model';
import { PERMISSION_KEYS } from '@/core/types';

export async function createRoleAction(formData: FormData) {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.manage');
  const name = String(formData.get('name') || '').trim();
  const validPermissions = new Set<string>(PERMISSION_KEYS);
  const permissions = formData.getAll('permissions').map(String).filter((key) => validPermissions.has(key));

  if (!name) return;

  await createRole({
    organizationId: tenant.organizationId,
    name,
    permissions,
  });
  revalidatePath('/users-roles');
  revalidatePath('/dashboard');
}

export async function createUserAction(formData: FormData) {
  const tenant = await requireModuleAccess('users_roles', 'users_roles.manage');
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const roleId = String(formData.get('roleId') || '');

  if (!name || !email || !password || !roleId) return;

  const created = await createUser({
    organizationId: tenant.organizationId,
    roleId,
    name,
    email,
    password,
  });
  if (!created) return;
  revalidatePath('/users-roles');
  revalidatePath('/dashboard');
}
