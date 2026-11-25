import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import type { GeneratePayrollInput } from '@/core/types';

type PayrollActionResult =
  | { success: true; created: number; skipped: number }
  | { success: false; error: string };

const FINALIZED_STATUSES = new Set(['APPROVED', 'PAID', 'REVERSED']);

export async function generateMonthlyPayroll(
  input: GeneratePayrollInput,
): Promise<PayrollActionResult> {
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { success: false, error: 'Month must be between 1 and 12.' };
  }
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    return { success: false, error: 'Year must be between 2000 and 2100.' };
  }
  if (!Number.isFinite(input.bonus) || input.bonus < 0) {
    return { success: false, error: 'Bonus must be a non-negative number.' };
  }
  if (!Number.isFinite(input.deductions) || input.deductions < 0) {
    return { success: false, error: 'Deductions must be a non-negative number.' };
  }

  const employees = await prisma.employee.findMany({
    where: { organizationId: input.organizationId, status: 'ACTIVE' },
  });

  if (employees.length === 0) {
    return { success: false, error: 'No active employees found for payroll generation.' };
  }

  return prisma.$transaction(async (tx) => {
    let created = 0;
    let skipped = 0;

    for (const employee of employees) {
      const existing = await tx.payroll.findUnique({
        where: {
          employeeId_month_year: {
            employeeId: employee.id,
            month: input.month,
            year: input.year,
          },
        },
        select: { id: true, status: true },
      });

      if (existing && FINALIZED_STATUSES.has(existing.status)) {
        skipped += 1;
        continue;
      }

      const basic = new Prisma.Decimal(employee.basicSalary);
      const bonus = new Prisma.Decimal(input.bonus);
      const deductions = new Prisma.Decimal(input.deductions);
      const netSalaryRaw = basic.add(bonus).sub(deductions);
      const netSalary = netSalaryRaw.lt(0) ? new Prisma.Decimal(0) : netSalaryRaw;

      await tx.payroll.upsert({
        where: {
          employeeId_month_year: {
            employeeId: employee.id,
            month: input.month,
            year: input.year,
          },
        },
        update: {
          basicSalary: basic,
          bonus,
          deductions,
          netSalary,
          // Do not overwrite status for non-finalized records.
        },
        create: {
          organizationId: input.organizationId,
          employeeId: employee.id,
          month: input.month,
          year: input.year,
          basicSalary: basic,
          bonus,
          deductions,
          netSalary,
          status: 'APPROVED',
        },
      });
      created += 1;
    }

    return { success: true, created, skipped };
  });
}

export async function markPayrollPaid(
  payrollId: string,
  organizationId: string,
  enabledModules: string[],
): Promise<PayrollActionResult | { success: true } | { success: false; error: string }> {
  const payroll = await prisma.payroll.findFirst({
    where: { id: payrollId, organizationId },
    include: { employee: true },
  });

  if (!payroll) {
    return { success: false, error: 'Payroll record not found.' };
  }
  if (payroll.status === 'PAID') {
    return { success: false, error: 'Payroll record is already paid.' };
  }
  if (payroll.status !== 'APPROVED') {
    return { success: false, error: 'Only approved payroll records can be marked as paid.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.payroll.update({
      where: { id: payroll.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    if (enabledModules.includes('accounting')) {
      const existing = await tx.accountTransaction.findFirst({
        where: {
          organizationId,
          reference: `PAYROLL:${payroll.id}`,
        },
        select: { id: true },
      });
      if (!existing) {
        await tx.accountTransaction.create({
          data: {
            organizationId,
            type: 'EXPENSE',
            category: 'Payroll',
            reference: `PAYROLL:${payroll.id}`,
            description: `Salary payout for ${payroll.employee.fullName} (${payroll.month}/${payroll.year})`,
            amount: payroll.netSalary,
          },
        });
      }
    }
  });

  return { success: true };
}

export async function listPayrolls(organizationId: string) {
  return prisma.payroll.findMany({
    where: { organizationId },
    include: { employee: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
}
