import { prisma } from '@/core/db/prisma';
import { deductStockForSales } from '@/modules/inventory/service';
import type { CreateInvoiceInput, CreateSalesCustomerInput } from '@/core/types';

export async function createCustomer(input: CreateSalesCustomerInput) {
  await prisma.customer.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
    },
  });
}

export async function createInvoice(input: CreateInvoiceInput) {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
  });
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId },
  });
  if (!product || !customer) return { success: false, error: 'Product or customer not found.' } as const;

  const unitPrice = Number(product.sellingPrice);
  const subtotal = unitPrice * input.quantity;
  const taxAmount = (subtotal * input.taxPercent) / 100;
  const totalAmount = subtotal + taxAmount;
  const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        organizationId: input.organizationId,
        customerId: input.customerId,
        invoiceNumber,
        status: 'PAID',
        subtotal,
        taxAmount,
        totalAmount,
        items: {
          create: [
            {
              productId: product.id,
              description: product.name,
              quantity: input.quantity,
              unitPrice,
              total: subtotal,
            },
          ],
        },
      },
    });

    if (input.enabledModules.includes('inventory')) {
      const deduction = await deductStockForSales(tx, {
        organizationId: input.organizationId,
        items: [{ productId: product.id, quantity: input.quantity }],
        referenceType: 'INVOICE',
        referenceId: invoice.id,
        invoiceId: invoice.id,
        actorId: input.actorUserId ?? undefined,
        notes: `Sales invoice ${invoiceNumber} posted`,
      });
      if (!deduction.success) {
        return { success: false, error: deduction.error };
      }
    }
    return { success: true } as const;
  });
}

export async function listCustomers(organizationId: string) {
  return prisma.customer.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listInvoices(organizationId: string) {
  return prisma.invoice.findMany({
    where: { organizationId },
    include: { customer: true, items: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listInvoiceFormOptions(organizationId: string) {
  return Promise.all([
    prisma.customer.findMany({ where: { organizationId } }),
    prisma.product.findMany({ where: { organizationId } }),
  ]);
}
