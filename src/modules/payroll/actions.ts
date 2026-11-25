'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { generateMonthlyPayroll, markPayrollPaid } from './model';

export async function generateMonthlyPayrollAction(formData: FormData) {
  const tenant = await requireModuleAccess('payroll', 'payroll.manage');
  const month = Number(formData.get('month') || new Date().getMonth() + 1);
  const year = Number(formData.get('year') || new Date().getFullYear());
  const bonus = Number(formData.get('bonus') || 0);
  const deductions = Number(formData.get('deductions') || 0);

  await generateMonthlyPayroll({
    organizationId: tenant.organizationId,
    month,
    year,
    bonus,
    deductions,
  });
  revalidatePath('/payroll/runs');
}

export async function markPayrollPaidAction(payrollId: string) {
  const tenant = await requireModuleAccess('payroll', 'payroll.manage');
  await markPayrollPaid(payrollId, tenant.organizationId, tenant.enabledModules);

  revalidatePath('/payroll/runs');
  revalidatePath('/accounting');
  revalidatePath('/dashboard');
}
