import { prisma } from "@/core/db/prisma";
import type { DashboardData } from "@/core/types";

export async function getDashboardMetrics(
  organizationId: string,
): Promise<DashboardData> {
  const now = new Date();
  const historyStart = new Date(now.getFullYear() - 4, 0, 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );

  const [
    employeeCount,
    managerCount,
    payrollSum,
    customerCount,
    projectCount,
    incomeSum,
    expenseSum,
    productCount,
    invoiceSum,
    transactions,
    revenueInvoices,
    projects,
    tasksByStatus,
    stockItems,
    pendingLeaves,
    presentToday,
    leadStages,
    invoiceStatuses,
    recentInvoices,
    pendingPurchaseOrders,
  ] = await Promise.all([
    prisma.employee.count({
      where: { organizationId, status: "ACTIVE" },
    }),
    prisma.user.count({
      where: {
        organizationId,
        isActive: true,
        role: { is: { name: "Manager" } },
      },
    }),
    prisma.payroll.aggregate({
      where: { organizationId },
      _sum: { netSalary: true },
    }),
    prisma.customer.count({ where: { organizationId } }),
    prisma.project.count({ where: { organizationId } }),
    prisma.accountTransaction.aggregate({
      where: { organizationId, type: "INCOME" },
      _sum: { amount: true },
    }),
    prisma.accountTransaction.aggregate({
      where: { organizationId, type: "EXPENSE" },
      _sum: { amount: true },
    }),
    prisma.product.count({ where: { organizationId } }),
    prisma.invoice.aggregate({
      where: { organizationId },
      _sum: { totalAmount: true },
    }),

    prisma.accountTransaction.findMany({
      where: {
        organizationId,
        date: { gte: historyStart },
      },
      select: {
        id: true,
        type: true,
        category: true,
        reference: true,
        description: true,
        amount: true,
        date: true,
      },
      orderBy: { date: "desc" },
    }),

    prisma.invoice.findMany({
      where: {
        organizationId,
        status: "PAID",
        createdAt: { gte: historyStart },
      },
      select: {
        totalAmount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),

    prisma.project.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        status: true,
        deadline: true,
        budget: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),

    prisma.projectTask.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { _all: true },
    }),

    prisma.stockItem.findMany({
      where: {
        product: { organizationId },
      },
      select: {
        quantity: true,
        product: {
          select: {
            name: true,
            sku: true,
            reorderLevel: true,
          },
        },
        warehouse: {
          select: { name: true },
        },
      },
    }),

    prisma.leaveRequest.count({
      where: { organizationId, status: "PENDING" },
    }),

    prisma.attendance.count({
      where: {
        organizationId,
        date: {
          gte: todayStart,
          lt: tomorrowStart,
        },
        status: "PRESENT",
      },
    }),

    prisma.lead.groupBy({
      by: ["stage"],
      where: { organizationId },
      _count: { _all: true },
    }),

    prisma.invoice.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { _all: true },
    }),

    prisma.invoice.findMany({
      where: { organizationId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),

    prisma.purchaseOrder.count({
      where: {
        organizationId,
        status: { not: "RECEIVED" },
      },
    }),
  ]);

  const lowStockItems = stockItems
    .filter((item) => item.quantity <= item.product.reorderLevel)
    .map((item) => ({
      productName: item.product.name,
      sku: item.product.sku,
      quantity: item.quantity,
      reorderLevel: item.product.reorderLevel,
      warehouse: item.warehouse.name,
    }));

  return {
    totals: {
      employeeCount,
      managerCount,
      payroll: Number(payrollSum._sum.netSalary || 0),
      customerCount,
      projectCount,
      income: Number(incomeSum._sum.amount || 0),
      expense: Number(expenseSum._sum.amount || 0),
      productCount,
      invoiceTotal: Number(invoiceSum._sum.totalAmount || 0),
    },

    transactions: transactions.map((item) => ({
      id: item.id,
      type: item.type,
      category: item.category,
      reference: item.reference,
      description: item.description,
      amount: Number(item.amount),
      date: item.date.toISOString(),
    })),

    revenueInvoices: revenueInvoices.map((invoice) => ({
      amount: Number(invoice.totalAmount),
      date: invoice.createdAt.toISOString(),
    })),

    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      deadline: project.deadline?.toISOString() || null,
      budget: Number(project.budget),
      customer: project.customer?.name || "No customer",
    })),

    taskSummary: tasksByStatus.map((item) => ({
      status: item.status,
      count: item._count._all,
    })),

    lowStockItems,
    pendingLeaves,
    presentToday,

    leadSummary: leadStages.map((item) => ({
      stage: item.stage,
      count: item._count._all,
    })),

    invoiceSummary: invoiceStatuses.map((item) => ({
      status: item.status,
      count: item._count._all,
    })),

    recentInvoices: recentInvoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      amount: Number(invoice.totalAmount),
      date: invoice.createdAt.toISOString(),
      customer: invoice.customer.name,
    })),

    pendingPurchaseOrders,
  };
}
