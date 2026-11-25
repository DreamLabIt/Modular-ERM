import { prisma } from '@/core/db/prisma';
import type { GeneratePayrollInput } from '@/core/types';

export async function generateMonthlyPayroll(input: GeneratePayrollInput) {
  const employees = await prisma.employee.findMany({
    where: { organizationId: input.organizationId, status: 'ACTIVE' },
  });

  for (const employee of employees) {
    const basic = Number(employee.basicSalary);
    const netSalary = Math.max(0, basic + input.bonus - input.deductions);

    await prisma.payroll.upsert({
      where: {
        employeeId_month_year: {
          employeeId: employee.id,
          month: input.month,
          year: input.year,
        },
      },
      update: {
        basicSalary: basic,
        bonus: input.bonus,
        deductions: input.deductions,
        netSalary,
      },
      create: {
        organizationId: input.organizationId,
        employeeId: employee.id,
        month: input.month,
        year: input.year,
        basicSalary: basic,
        bonus: input.bonus,
        deductions: input.deductions,
        netSalary,
        status: 'APPROVED',
      },
    });
  }
}

export async function markPayrollPaid(payrollId: string, organizationId: string, enabledModules: string[]) {
  const payroll = await prisma.payroll.findFirst({
    where: { id: payrollId, organizationId },
    include: { employee: true },
  });

  if (payroll && payroll.status !== 'PAID') {
    await prisma.$transaction(async (tx) => {
      await tx.payroll.update({
        where: { id: payroll.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      if (enabledModules.includes('accounting')) {
        await tx.accountTransaction.create({
          data: {
            organizationId,
            type: 'EXPENSE',
            category: 'Payroll',
            reference: `PAY-${payroll.month}-${payroll.year}`,
            description: `Salary payout for ${payroll.employee.fullName}`,
            amount: payroll.netSalary,
          },
        });
      }
    });
  }
}

export async function listPayrolls(organizationId: string) {
  return prisma.payroll.findMany({
    where: { organizationId },
    include: { employee: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
}
