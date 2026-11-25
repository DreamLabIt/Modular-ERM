'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { adjustStock, createProduct } from './model';

export async function createProductAction(formData: FormData) {
  const tenant = await requireModuleAccess('inventory', 'inventory.manage');
  const sku = String(formData.get('sku') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const unit = String(formData.get('unit') || 'pcs').trim();
  const costPrice = Number(formData.get('costPrice') || 0);
  const sellingPrice = Number(formData.get('sellingPrice') || 0);
  const initialStock = Number(formData.get('initialStock') || 0);

  if (!sku || !name) return;

  await createProduct({
    organizationId: tenant.organizationId,
    sku,
    name,
    unit,
    costPrice,
    sellingPrice,
    initialStock,
  });

  revalidatePath('/inventory/products');
}

export async function adjustStockAction(productId: string, delta: number) {
  const tenant = await requireModuleAccess('inventory', 'inventory.manage');
  await adjustStock(productId, delta, tenant.organizationId);
  revalidatePath('/inventory/products');
}
