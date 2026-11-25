'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/core/auth/module-guard';
import { setModuleEnabled, updateBranding } from '@/modules/settings/model';

export async function updateBrandingAction(formData: FormData) {
  const tenant = await requirePermission('settings.manage');
  const name = String(formData.get('name') || '').trim();
  const primaryColor = String(formData.get('primaryColor') || '#2563eb');
  const currency = String(formData.get('currency') || 'BDT').trim();
  const address = String(formData.get('address') || '').trim();

  if (!name) return;

  await updateBranding({
    organizationId: tenant.organizationId,
    name,
    primaryColor,
    currency,
    address,
  });
  revalidatePath('/', 'layout');
}

export async function toggleModuleAction(moduleKey: string, enable: boolean) {
  const tenant = await requirePermission('settings.manage');
  await setModuleEnabled(tenant.organizationId, moduleKey, enable);
  revalidatePath('/', 'layout');
}
