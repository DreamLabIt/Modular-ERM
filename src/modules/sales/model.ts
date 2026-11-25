import { prisma } from '@/core/db/prisma';
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
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { success: false, error: 'Quantity must be a positive whole number.' } as const;
  }
  if (!Number.isFinite(input.taxPercent) || input.taxPercent < 0 || input.taxPercent > 100) {
    return { success: false, error: 'Tax percent must be between 0 and 100.' } as const;
  }

  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
  });
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId },
  });
  if (!product || !customer) {
    return { success: false, error: 'Product or customer not found.' } as const;
  }

  const unitPrice = Number(product.sellingPrice);
  const subtotal = unitPrice * input.quantity;
  const taxAmount = (subtotal * input.taxPercent) / 100;
  const totalAmount = subtotal + taxAmount;
  const invoiceNumber = `INV-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  await prisma.invoice.create({
    data: {
      organizationId: input.organizationId,
      customerId: input.customerId,
      invoiceNumber,
      status: 'DRAFT',
      subtotal,
      taxAmount,
      totalAmount,
      dueDate: input.dueDate ?? null,
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

  return { success: true } as const;
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
