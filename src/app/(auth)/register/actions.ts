'use server';

import bcrypt from 'bcryptjs';
import { isEmailRegistered, registerOrganization } from '@/modules/registration/model';
import { MODULE_REGISTRY } from '@/core/modules/registry';

export async function registerOrganizationAction(formData: FormData) {
  const companyName = String(formData.get('companyName') || '').trim();
  const ownerName = String(formData.get('ownerName') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const selectedModules = formData.getAll('modules').map(String);

  if (!companyName || !ownerName || !email || !password) {
    return { error: 'All fields are required.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Enter a valid email address.' };
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  if (await isEmailRegistered(email)) return { error: 'Email is already registered.' };

  const validModuleKeys = new Set(Object.keys(MODULE_REGISTRY));
  const safeSelectedModules = Array.from(new Set(selectedModules)).filter((key) => validModuleKeys.has(key));

  const passwordHash = await bcrypt.hash(password, 10);
  await registerOrganization({
    companyName,
    ownerName,
    email,
    passwordHash,
    selectedModules: safeSelectedModules,
  });

  return { success: true };
}
