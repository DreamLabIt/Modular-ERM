import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import type {
  CreateInvoiceInput,
  CreatePurchaseOrderInput,
  CreateSupplierInput,
} from '@/core/types';
import {
  calculateTotalPaid,
  calculateOutstandingBalance,
  getEffectiveInvoiceStatus,
  PAYMENT_METHODS,
} from './workflow';

type ModelResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

function createInvoiceNumber() {
  return `INV-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<ModelResult<string>> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
  });
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId },
  });
  if (!product || !customer) {
    return { success: false, error: 'Customer or product does not belong to this organization.' };
  }

  const subtotal = new Prisma.Decimal(product.sellingPrice).mul(input.quantity);
  const taxPercent = new Prisma.Decimal(input.taxPercent);
  const taxAmount = subtotal.mul(taxPercent).div(100);
  const totalAmount = subtotal.plus(taxAmount);
  if (totalAmount.lessThanOrEqualTo(0)) {
    return { success: false, error: 'Invoice total must be positive.' };
  }

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      return tx.invoice.create({
        data: {
          organizationId: input.organizationId,
          customerId: customer.id,
          invoiceNumber: createInvoiceNumber(),
          status: 'DRAFT',
          subtotal,
          taxAmount,
          totalAmount,
          dueDate: input.dueDate ?? null,
          items: {
            create: [{
              productId: product.id,
              description: product.name,
              quantity: input.quantity,
              unitPrice: product.sellingPrice,
              total: subtotal,
            }],
          },
        },
      });
    });
    return { success: true, data: invoice.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not create invoice.' };
  }
}

export async function updateDraftInvoice(input: {
  organizationId: string;
  invoiceId: string;
  customerId: string;
  productId: string;
  quantity: number;
  taxPercent: number;
  dueDate?: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.organizationId },
      include: { items: true, payments: true },
    });
    if (!invoice) return { success: false, error: 'Invoice not found.' } as const;
    if (invoice.status !== 'DRAFT') return { success: false, error: 'Only draft invoices can be edited.' } as const;
    if (invoice.payments.length > 0) return { success: false, error: 'Draft invoice already has payment history.' } as const;

    const [customer, product] = await Promise.all([
      tx.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId } }),
      tx.product.findFirst({ where: { id: input.productId, organizationId: input.organizationId } }),
    ]);
    if (!customer || !product) return { success: false, error: 'Customer or product is invalid.' } as const;

    const subtotal = new Prisma.Decimal(product.sellingPrice).mul(input.quantity);
    const taxAmount = subtotal.mul(new Prisma.Decimal(input.taxPercent)).div(100);
    const totalAmount = subtotal.plus(taxAmount);
    if (totalAmount.lessThanOrEqualTo(0)) return { success: false, error: 'Invoice total must be positive.' } as const;

    await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        customerId: customer.id,
        dueDate: input.dueDate ?? null,
        subtotal,
        taxAmount,
        totalAmount,
        items: {
          create: [{
            productId: product.id,
            description: product.name,
            quantity: input.quantity,
            unitPrice: product.sellingPrice,
            total: subtotal,
          }],
        },
      },
    });
    return { success: true } as const;
  });
}

export async function deleteDraftInvoice(organizationId: string, invoiceId: string) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { payments: true },
    });
    if (!invoice) return { success: false, error: 'Invoice not found.' } as const;
    if (invoice.status !== 'DRAFT') return { success: false, error: 'Only draft invoices can be deleted.' } as const;
    if (invoice.payments.length > 0) return { success: false, error: 'Cannot delete an invoice with payment history.' } as const;
    await tx.invoice.delete({ where: { id: invoice.id } });
    return { success: true } as const;
  });
}

export async function issueInvoice(input: {
  organizationId: string;
  invoiceId: string;
  dueDate: Date;
  enabledModules: string[];
}) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.organizationId },
      include: { items: true },
    });
    if (!invoice) return { success: false, error: 'Invoice not found.' } as const;
    if (invoice.status !== 'DRAFT') return { success: false, error: 'Only draft invoices can be issued.' } as const;
    if (invoice.inventoryDeducted) return { success: false, error: 'Invoice stock has already been deducted.' } as const;

    const issueDate = new Date();
    if (input.dueDate.getTime() < startOfDay(issueDate).getTime()) {
      return { success: false, error: 'Due date cannot precede the issue date.' } as const;
    }

    if (input.enabledModules.includes('inventory')) {
      for (const item of invoice.items) {
        let remaining = item.quantity;
        const stocks = await tx.stockItem.findMany({
          where: {
            productId: item.productId,
            warehouse: { organizationId: input.organizationId },
          },
          orderBy: { quantity: 'desc' },
        });
        const available = stocks.reduce((sum, stock) => sum + stock.quantity, 0);
        if (available < remaining) {
          return { success: false, error: `Insufficient stock for ${item.description}.` } as const;
        }

        for (const stock of stocks) {
          if (remaining <= 0) break;
          const deducted = Math.min(stock.quantity, remaining);
          const updated = await tx.stockItem.updateMany({
            where: { id: stock.id, quantity: { gte: deducted } },
            data: { quantity: { decrement: deducted } },
          });
          if (updated.count !== 1) return { success: false, error: 'Stock changed concurrently. Retry issuance.' } as const;
          await tx.invoiceStockMovement.upsert({
            where: {
              invoiceId_productId_warehouseId: {
                invoiceId: invoice.id,
                productId: item.productId,
                warehouseId: stock.warehouseId,
              },
            },
            create: {
              organizationId: input.organizationId,
              invoiceId: invoice.id,
              productId: item.productId,
              warehouseId: stock.warehouseId,
              quantity: deducted,
            },
            update: { quantity: { increment: deducted } },
          });
          remaining -= deducted;
        }
      }
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'SENT',
        issueDate,
        dueDate: input.dueDate,
        inventoryDeducted: input.enabledModules.includes('inventory'),
      },
    });
    return { success: true } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function recordInvoicePayment(input: {
  organizationId: string;
  invoiceId: string;
  receivedById: string;
  amount: number | string;
  paymentDate: Date;
  paymentMethod: string;
  referenceNumber?: string;
  notes?: string;
  idempotencyKey?: string;
  enabledModules: string[];
}) {
  if (!PAYMENT_METHODS.includes(input.paymentMethod as (typeof PAYMENT_METHODS)[number])) {
    return { success: false, error: 'Invalid payment method.' } as const;
  }
  const amount = new Prisma.Decimal(input.amount);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    return { success: false, error: 'Payment amount must be positive.' } as const;
  }

  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.invoicePayment.findFirst({
        where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        if (existing.invoiceId !== input.invoiceId) {
          return { success: false, error: 'Payment submission key is already associated with another invoice.' } as const;
        }
        return { success: true, data: { duplicate: true, paymentId: existing.id } } as const;
      }
    }

    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.organizationId },
      include: { payments: true },
    });
    if (!invoice) return { success: false, error: 'Invoice not found.' } as const;
    if (invoice.status === 'DRAFT') return { success: false, error: 'Draft invoices cannot receive payments.' } as const;
    if (invoice.status === 'CANCELLED') return { success: false, error: 'Cancelled invoices cannot receive payments.' } as const;
    if (invoice.status === 'PAID') return { success: false, error: 'The invoice is already fully paid.' } as const;
    if (!['SENT', 'PARTIALLY_PAID'].includes(invoice.status)) {
      return { success: false, error: 'The invoice is not eligible for payment.' } as const;
    }

    const totalPaid = calculateTotalPaid(invoice.payments);
    const outstanding = calculateOutstandingBalance(invoice.totalAmount, totalPaid);
    if (outstanding.lessThanOrEqualTo(0)) {
      return { success: false, error: 'The invoice is already fully paid.' } as const;
    }
    if (amount.greaterThan(outstanding)) {
      return { success: false, error: `Payment cannot exceed the outstanding balance of ${outstanding.toFixed(2)}.` } as const;
    }

    const payment = await tx.invoicePayment.create({
      data: {
        organizationId: input.organizationId,
        invoiceId: invoice.id,
        amount,
        paymentDate: input.paymentDate,
        paymentMethod: input.paymentMethod,
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || null,
        receivedById: input.receivedById,
        idempotencyKey: input.idempotencyKey || null,
      },
    });

    const newTotalPaid = totalPaid.plus(amount);
    const newOutstanding = calculateOutstandingBalance(invoice.totalAmount, newTotalPaid);
    const status = newOutstanding.equals(0) ? 'PAID' : 'PARTIALLY_PAID';

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status,
        paidAt: status === 'PAID' ? input.paymentDate : null,
      },
    });

    if (input.enabledModules.includes('accounting')) {
      await tx.accountTransaction.create({
        data: {
          organizationId: input.organizationId,
          type: 'INCOME',
          category: 'Sales Revenue',
          reference: `${invoice.invoiceNumber} / PAYMENT ${payment.id}`,
          description: `Customer payment ${payment.id} for Sales Invoice ${invoice.invoiceNumber}`,
          amount,
          invoicePaymentId: payment.id,
        },
      });
    }
    return { success: true, data: { duplicate: false, paymentId: payment.id } } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function cancelInvoice(input: {
  organizationId: string;
  invoiceId: string;
  cancelledById: string;
  enabledModules: string[];
}) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.organizationId },
      include: { payments: true, stockMovements: true },
    });
    if (!invoice) return { success: false, error: 'Invoice not found.' } as const;
    if (invoice.status === 'PAID') return { success: false, error: 'Paid invoices require a refund/reversal workflow.' } as const;
    if (invoice.status === 'CANCELLED') return { success: false, error: 'Invoice is already cancelled.' } as const;
    if (!['DRAFT', 'SENT', 'PARTIALLY_PAID'].includes(invoice.status)) {
      return { success: false, error: 'Invoice cannot be cancelled.' } as const;
    }
    if (invoice.payments.length > 0) {
      return { success: false, error: 'Invoices with payment history cannot be cancelled; use a reversal/refund workflow.' } as const;
    }

    if (
      input.enabledModules.includes('inventory') &&
      invoice.inventoryDeducted &&
      !invoice.stockRestored
    ) {
      for (const movement of invoice.stockMovements) {
        await tx.stockItem.updateMany({
          where: {
            productId: movement.productId,
            warehouseId: movement.warehouseId,
            warehouse: { organizationId: input.organizationId },
          },
          data: { quantity: { increment: movement.quantity } },
        });
      }
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: input.cancelledById,
        stockRestored: invoice.inventoryDeducted,
      },
    });
    return { success: true } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function listInvoices(organizationId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { organizationId },
    include: {
      customer: true,
      items: { include: { product: true } },
      payments: { orderBy: { paymentDate: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return invoices.map((invoice) => {
    const totalPaid = calculateTotalPaid(invoice.payments);
    return {
      ...invoice,
      totalPaid,
      outstandingBalance: calculateOutstandingBalance(invoice.totalAmount, totalPaid),
      effectiveStatus: getEffectiveInvoiceStatus({
        status: invoice.status,
        dueDate: invoice.dueDate,
        totalAmount: invoice.totalAmount,
        totalPaid,
      }),
    };
  });
}

export async function listInvoiceFormOptions(organizationId: string) {
  return Promise.all([
    prisma.customer.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
  ]);
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
  const product = await prisma.product.findFirst({ where: { id: input.productId, organizationId: input.organizationId } });
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId: input.organizationId } });
  if (!product || !supplier) return false;

  const unitCost = new Prisma.Decimal(product.costPrice);
  const totalAmount = unitCost.mul(input.quantity);
  const poNumber = `PO-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.create({
      data: {
        organizationId: input.organizationId,
        supplierId: input.supplierId,
        poNumber,
        status: 'RECEIVED',
        totalAmount,
        items: { create: [{ productId: product.id, quantity: input.quantity, unitCost, total: totalAmount }] },
      },
    });
    if (input.enabledModules.includes('inventory')) {
      const warehouse = await tx.warehouse.findFirst({ where: { organizationId: input.organizationId } });
      if (warehouse) {
        await tx.stockItem.upsert({
          where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
          create: { productId: product.id, warehouseId: warehouse.id, quantity: input.quantity },
          update: { quantity: { increment: input.quantity } },
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

function startOfDay(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
}
