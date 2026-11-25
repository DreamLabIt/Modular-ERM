'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { createTransaction } from './model';

export async function createTransactionAction(formData: FormData) {
  const tenant = await requireModuleAccess('accounting', 'accounting.manage');
  const type = String(formData.get('type') || 'INCOME');
  const category = String(formData.get('category') || 'General').trim();
  const reference = String(formData.get('reference') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const amount = Number(formData.get('amount') || 0);

  if (!description || amount <= 0) return;

  await createTransaction({
    organizationId: tenant.organizationId,
    type,
    category,
    reference: reference || null,
    description,
    amount,
  });
  revalidatePath('/accounting');
  revalidatePath('/dashboard');
}
