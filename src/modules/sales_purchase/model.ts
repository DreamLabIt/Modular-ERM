import { prisma } from '@/core/db/prisma';
import type { CreateInvoiceInput, CreatePurchaseOrderInput, CreateSupplierInput } from '@/core/types';

export async function createInvoice(input: CreateInvoiceInput) {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
  });
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId },
  });
  if (!product || !customer) return false;

  const unitPrice = Number(product.sellingPrice);
  const subtotal = unitPrice * input.quantity;
  const taxAmount = (subtotal * input.taxPercent) / 100;
  const totalAmount = subtotal + taxAmount;
  const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;

  await prisma.$transaction(async (tx) => {
    await tx.invoice.create({
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
      const stock = await tx.stockItem.findFirst({ where: { productId: product.id } });
      if (stock) {
        await tx.stockItem.update({
          where: { id: stock.id },
          data: { quantity: Math.max(0, stock.quantity - input.quantity) },
        });
      }
    }

    if (input.enabledModules.includes('accounting')) {
      await tx.accountTransaction.create({
        data: {
          organizationId: input.organizationId,
          type: 'INCOME',
          category: 'Sales Revenue',
          reference: invoiceNumber,
          description: `Sales Invoice ${invoiceNumber} (${product.name} x${input.quantity})`,
          amount: totalAmount,
        },
      });
    }
  });
  return true;
}

export async function createSupplier(input: CreateSupplierInput) {
  await prisma.supplier.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      email: input.email,
      phone: input.phone,
    },
  });
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput) {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
  });
  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, organizationId: input.organizationId },
  });
  if (!product || !supplier) return false;

  const unitCost = Number(product.costPrice);
  const totalAmount = unitCost * input.quantity;
  const poNumber = `PO-${Date.now().toString().slice(-6)}`;

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.create({
      data: {
        organizationId: input.organizationId,
        supplierId: input.supplierId,
        poNumber,
        status: 'RECEIVED',
        totalAmount,
        items: {
          create: [{ productId: product.id, quantity: input.quantity, unitCost, total: totalAmount }],
        },
      },
    });

    if (input.enabledModules.includes('inventory')) {
      const stock = await tx.stockItem.findFirst({ where: { productId: product.id } });
      if (stock) {
        await tx.stockItem.update({
          where: { id: stock.id },
          data: { quantity: stock.quantity + input.quantity },
        });
      }
    }

    if (input.enabledModules.includes('accounting')) {
      await tx.accountTransaction.create({
        data: {
          organizationId: input.organizationId,
          type: 'EXPENSE',
          category: 'Inventory Purchase',
          reference: poNumber,
          description: `Purchase Order ${poNumber} (${product.name} x${input.quantity})`,
          amount: totalAmount,
        },
      });
    }
  });
  return true;
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

export async function listPurchaseOrderData(organizationId: string) {
  return Promise.all([
    prisma.purchaseOrder.findMany({
      where: { organizationId },
      include: { supplier: true, items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.supplier.findMany({ where: { organizationId } }),
    prisma.product.findMany({ where: { organizationId } }),
  ]);
}
