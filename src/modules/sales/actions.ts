'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { createCustomer, createInvoice } from './model';

export async function createCustomerAction(formData: FormData) {
  const tenant = await requireModuleAccess('sales', 'sales.create');

  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const address = String(formData.get('address') || '').trim();

  if (!name) return;

  await createCustomer({
    organizationId: tenant.organizationId,
    name,
    email: email || null,
    phone: phone || null,
    address: address || null,
  });

  revalidatePath('/sales/customers');
}

export async function createInvoiceAction(formData: FormData) {
  const tenant = await requireModuleAccess('sales', 'sales.create');

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
    actorUserId: tenant.userId,
  });

  revalidatePath('/sales/invoices');
  revalidatePath('/inventory/products');
  revalidatePath('/dashboard');
}
