'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { createCustomer, createLead } from './model';

export async function createCustomerAction(formData: FormData) {
  const tenant = await requireModuleAccess('crm', 'crm.manage');
  const name = String(formData.get('name') || '').trim();
  const company = String(formData.get('company') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const status = String(formData.get('status') || 'ACTIVE');

  if (!name) return;

  await createCustomer({
    organizationId: tenant.organizationId,
    name,
    company,
    email,
    phone,
    status,
  });
  revalidatePath('/crm/customers');
}

export async function createLeadAction(formData: FormData) {
  const tenant = await requireModuleAccess('crm', 'crm.manage');
  const title = String(formData.get('title') || '').trim();
  const contactName = String(formData.get('contactName') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const estimatedValue = Number(formData.get('estimatedValue') || 0);
  const stage = String(formData.get('stage') || 'NEW');

  if (!title || !contactName) return;

  await createLead({
    organizationId: tenant.organizationId,
    title,
    contactName,
    email,
    estimatedValue,
    stage,
  });
  revalidatePath('/crm/leads');
}
