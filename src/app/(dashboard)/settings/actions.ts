'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/core/auth/module-guard';
import { MODULE_REGISTRY } from '@/core/modules/registry';
import { setModuleEnabled, updateBranding } from '@/modules/settings/model';

export async function updateBrandingAction(formData: FormData): Promise<void> {
  const tenant = await requirePermission('settings.manage');
  const name = String(formData.get('name') || '').trim();
  const primaryColor = String(formData.get('primaryColor') || '#2563eb').trim();
  const currency = String(formData.get('currency') || 'BDT').trim().toUpperCase();
  const address = String(formData.get('address') || '').trim();

  if (!name) return;
  if (name.length > 120) return;
  if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) return;
  if (!/^[A-Z]{3,5}$/.test(currency)) return;

  await updateBranding({
    organizationId: tenant.organizationId,
    name,
    primaryColor,
    currency,
    address: address.slice(0, 500),
  });
  revalidatePath('/', 'layout');
}

export async function toggleModuleAction(moduleKey: string, enable: boolean): Promise<void> {
  const tenant = await requirePermission('settings.manage');
  if (!(moduleKey in MODULE_REGISTRY)) return;
  await setModuleEnabled(tenant.organizationId, moduleKey, Boolean(enable));
  revalidatePath('/', 'layout');
}
