'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { createInvoice, createPurchaseOrder, createSupplier } from './model';

export async function createInvoiceAction(formData: FormData) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.manage');
  const customerId = String(formData.get('customerId') || '');
  const productId = String(formData.get('productId') || '');
  const quantity = Math.max(1, Number(formData.get('quantity') || 1));
  const taxPercent = Math.max(0, Number(formData.get('taxPercent') || 0));

  if (!customerId || !productId) return;

  await createInvoice({
    organizationId: tenant.organizationId,
    customerId,
    productId,
    quantity,
    taxPercent,
    enabledModules: tenant.enabledModules,
  });

  revalidatePath('/sales-purchase/invoices');
  revalidatePath('/inventory/products');
  revalidatePath('/accounting');
  revalidatePath('/dashboard');
}

export async function createSupplierAction(formData: FormData) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.manage');
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();

  if (!name) return;

  await createSupplier({
    organizationId: tenant.organizationId,
    name,
    email,
    phone,
  });
  revalidatePath('/sales-purchase/purchases');
}

export async function createPurchaseOrderAction(formData: FormData) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.manage');
  const supplierId = String(formData.get('supplierId') || '');
  const productId = String(formData.get('productId') || '');
  const quantity = Math.max(1, Number(formData.get('quantity') || 1));

  if (!supplierId || !productId) return;

  await createPurchaseOrder({
    organizationId: tenant.organizationId,
    supplierId,
    productId,
    quantity,
    enabledModules: tenant.enabledModules,
  });

  revalidatePath('/sales-purchase/purchases');
  revalidatePath('/inventory/products');
  revalidatePath('/accounting');
}
