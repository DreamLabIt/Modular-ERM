import { prisma } from '@/core/db/prisma';

export async function getReportData(organizationId: string) {
  return Promise.all([
    prisma.invoice.findMany({ where: { organizationId } }),
    prisma.purchaseOrder.findMany({ where: { organizationId } }),
    prisma.accountTransaction.findMany({ where: { organizationId } }),
    prisma.product.findMany({ where: { organizationId }, include: { stocks: true } }),
    prisma.employee.findMany({ where: { organizationId } }),
    prisma.project.findMany({ where: { organizationId } }),
    prisma.lead.findMany({ where: { organizationId } }),
  ]);
}
