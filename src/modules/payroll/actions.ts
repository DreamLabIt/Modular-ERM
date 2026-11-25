'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { generateMonthlyPayroll, markPayrollPaid } from './model';

export async function generateMonthlyPayrollAction(formData: FormData): Promise<void> {
  const tenant = await requireModuleAccess('payroll', 'payroll.manage');
  const month = Number(formData.get('month'));
  const year = Number(formData.get('year'));
  const bonus = Number(formData.get('bonus') || 0);
  const deductions = Number(formData.get('deductions') || 0);

  await generateMonthlyPayroll({
    organizationId: tenant.organizationId,
    month: Number.isFinite(month) ? month : new Date().getMonth() + 1,
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    bonus: Number.isFinite(bonus) ? bonus : 0,
    deductions: Number.isFinite(deductions) ? deductions : 0,
  });

  revalidatePath('/payroll/runs');
  revalidatePath('/dashboard');
}

export async function markPayrollPaidAction(payrollId: string): Promise<void> {
  const tenant = await requireModuleAccess('payroll', 'payroll.manage');
  await markPayrollPaid(payrollId, tenant.organizationId, tenant.enabledModules);

  revalidatePath('/payroll/runs');
  revalidatePath('/accounting');
  revalidatePath('/dashboard');
}
