import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { applyStockDelta, deductStockForSales } from '@/modules/inventory/service';
import type {
  CreateInvoiceInput,
  CreatePurchaseOrderInput,
  CreateSupplierInput,
} from '@/core/types';
import {
  calculateOutstandingBalance,
  calculateTotalPaid,
  getEffectiveInvoiceStatus,
  PAYMENT_METHODS,
} from './workflow';

type ModelResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

function createInvoiceNumber() {
  return `INV-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function createPoNumber() {
  return `PO-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

/**
 * Records an audit event using the existing SecurityAuditLog infrastructure.
 * Runs inside the caller's transaction; every actor must be a real User.
 */
export async function createSecurityAuditLog(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorUserId: string;
    targetType: string;
    targetId: string;
    action: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  },
) {
  return tx.securityAuditLog.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      before: input.before,
      after: input.after,
    },
  });
}

/**
 * Creates a Purchase Order in DRAFT status. Stock is NOT increased, no
 * accounting entry is created, and no goods are received here — that happens
 * only through valid Goods Receipts.
 */
export async function createPurchaseOrder(input: CreatePurchaseOrderInput) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { success: false, error: 'Add at least one item to the purchase order.' } as const;
  }

  const seenProducts = new Set<string>();
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { success: false, error: 'Order quantities must be positive whole numbers.' } as const;
    }
    if (seenProducts.has(item.productId)) {
      return { success: false, error: 'Each product can appear only once in the order.' } as const;
    }
    seenProducts.add(item.productId);
  }

  const [supplier, warehouse] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId: input.organizationId } }),
    prisma.warehouse.findFirst({ where: { id: input.warehouseId, organizationId: input.organizationId } }),
  ]);
  if (!supplier) {
    return { success: false, error: 'Supplier does not belong to this organization.' } as const;
  }
  if (!warehouse) {
    return { success: false, error: 'Warehouse does not belong to this organization.' } as const;
  }

  const products = await prisma.product.findMany({
    where: { organizationId: input.organizationId, id: { in: input.items.map((item) => item.productId) } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  for (const item of input.items) {
    if (!productById.has(item.productId)) {
      return { success: false, error: `Product ${item.productId} does not belong to this organization.` } as const;
    }
  }

  return prisma.$transaction(async (tx) => {
    // Generate a unique PO number within the organization scope, retrying on
    // uniqueness conflicts like the legacy generator did.
    let poNumber = createPoNumber();
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await tx.purchaseOrder.findFirst({
        where: { organizationId: input.organizationId, poNumber },
      });
      if (!existing) break;
      poNumber = createPoNumber();
    }

    const itemData = input.items.map((item) => {
      const product = productById.get(item.productId)!;
      const unitCost = new Prisma.Decimal(product.costPrice);
      const total = unitCost.mul(item.quantity);
      return {
        productId: product.id,
        orderedQuantity: item.quantity,
        previouslyReceived: 0,
        unitCost,
        total,
        notes: item.notes ?? null,
      };
    });

    const totalAmount = itemData.reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0));

    const po = await tx.purchaseOrder.create({
      data: {
        organizationId: input.organizationId,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        poNumber,
        status: 'DRAFT',
        expectedDate: input.expectedDate ?? null,
        createdById: input.actorUserId,
        totalAmount,
        items: { create: itemData },
      },
      include: { items: true },
    });

    await createSecurityAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: 'PURCHASE_ORDER',
      targetId: po.id,
      action: 'PO_CREATED',
      after: {
        poNumber: po.poNumber,
        status: po.status,
        supplierName: supplier.name,
        warehouseName: warehouse.name,
        itemCount: po.items.length,
      },
    });

    return { success: true, data: { id: po.id, poNumber } } as const;
  });
}

function validatePoItemInputs(items: Array<{ productId: string; quantity: number; notes?: string }>) {
  const seenProducts = new Set<string>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { success: false, error: 'Order quantities must be positive whole numbers.' } as const;
    }
    if (seenProducts.has(item.productId)) {
      return { success: false, error: 'Each product can appear only once in the order.' } as const;
    }
    seenProducts.add(item.productId);
  }
  return { success: true } as const;
}

/**
 * Edits a Purchase Order that is still in DRAFT status. Only the supplier,
 * warehouse, expected date and order lines can change; the PO number is
 * stable, stock is untouched and no accounting entries are created.
 */
export async function editPurchaseOrderDraft(input: {
  organizationId: string;
  purchaseOrderId: string;
  supplierId: string;
  warehouseId: string;
  expectedDate: Date | null;
  actorUserId: string;
  items: Array<{ productId: string; quantity: number; notes?: string }>;
}) {
  const validation = validatePoItemInputs(input.items);
  if (!validation.success) return validation;

  const [po, supplier, warehouse, products] = await Promise.all([
    prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, organizationId: input.organizationId },
    }),
    prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId: input.organizationId } }),
    prisma.warehouse.findFirst({ where: { id: input.warehouseId, organizationId: input.organizationId } }),
    prisma.product.findMany({
      where: { organizationId: input.organizationId, id: { in: input.items.map((item) => item.productId) } },
    }),
  ]);
  if (!po) return { success: false, error: 'Purchase Order not found.' } as const;
  if (po.status !== 'DRAFT') return { success: false, error: 'Only draft Purchase Orders can be edited.' } as const;
  if (!supplier) return { success: false, error: 'Supplier does not belong to this organization.' } as const;
  if (!warehouse) return { success: false, error: 'Warehouse does not belong to this organization.' } as const;
  const productById = new Map(products.map((product) => [product.id, product]));
  for (const item of input.items) {
    if (!productById.has(item.productId)) {
      return { success: false, error: `Product ${item.productId} does not belong to this organization.` } as const;
    }
  }

  return prisma.$transaction(async (tx) => {
    const itemData = input.items.map((item) => {
      const product = productById.get(item.productId)!;
      const unitCost = new Prisma.Decimal(product.costPrice);
      return {
        productId: product.id,
        orderedQuantity: item.quantity,
        previouslyReceived: 0,
        unitCost,
        total: unitCost.mul(item.quantity),
        notes: item.notes ?? null,
      };
    });
    const totalAmount = itemData.reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0));

    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
    const updated = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        expectedDate: input.expectedDate,
        totalAmount,
        items: { create: itemData },
      },
    });

    await createSecurityAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: 'PURCHASE_ORDER',
      targetId: po.id,
      action: 'PO_UPDATED',
      after: { poNumber: updated.poNumber, status: updated.status, itemCount: itemData.length },
    });

    return { success: true as const, data: { id: po.id } };
  });
}

export async function listPurchaseOrderData(organizationId: string) {
  return Promise.all([
    prisma.purchaseOrder.findMany({
      where: { organizationId },
      include: {
        supplier: true,
        warehouse: true,
        createdBy: true,
        items: { include: { product: true } },
        goodsReceipts: { include: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.supplier.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
    prisma.warehouse.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
  ]);
}

export async function getPurchaseOrderDetails(organizationId: string, purchaseOrderId: string) {
  return prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, organizationId },
    include: {
      supplier: true,
      warehouse: true,
      createdBy: true,
      approvedBy: true,
      items: { include: { product: true } },
      approvals: { orderBy: { createdAt: 'asc' } },
      goodsReceipts: {
        include: { items: { include: { product: true } } },
        orderBy: { receivedDate: 'asc' },
      },
    },
  });
}

export async function getGoodsReceipts(organizationId: string) {
  return prisma.goodsReceipt.findMany({
    where: { organizationId },
    include: {
      purchaseOrder: { include: { supplier: true, warehouse: true } },
      warehouse: true,
      items: { include: { product: true } },
      receivedBy: true,
    },
    orderBy: { receivedDate: 'desc' },
  });
}

export async function getGoodsReceiptById(organizationId: string, goodsReceiptId: string) {
  return prisma.goodsReceipt.findFirst({
    where: { id: goodsReceiptId, organizationId },
    include: {
      purchaseOrder: { include: { supplier: true, warehouse: true } },
      warehouse: true,
      items: { include: { product: true } },
      receivedBy: true,
    },
  });
}

export async function getAuditLogs(organizationId: string, targetType: string, targetId: string) {
  return prisma.securityAuditLog.findMany({
    where: { organizationId, targetType, targetId },
    orderBy: { createdAt: 'asc' },
    include: { actor: true },
  });
}

export async function getPurchaseOrderRemainingQuantities(
  organizationId: string,
  purchaseOrderId?: string,
) {
  const pos = await prisma.purchaseOrder.findMany({
    where: { organizationId, ...(purchaseOrderId ? { id: purchaseOrderId } : {}) },
    include: { items: { include: { product: true } } },
  });

  return pos.map((po) => ({
    purchaseOrderId: po.id,
    status: po.status,
    totalRemaining: po.items.reduce((sum, item) => sum + Math.max(0, item.orderedQuantity - item.previouslyReceived), 0),
    items: po.items.map((item) => ({
      purchaseOrderItemId: item.id,
      productId: item.productId,
      productName: item.product.name,
      unit: item.product.unit,
      orderedQuantity: item.orderedQuantity,
      previouslyReceived: item.previouslyReceived,
      remainingQuantity: Math.max(0, item.orderedQuantity - item.previouslyReceived),
    })),
  }));
}

export function createReceiptNumber() {
  return `GRN-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
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
  actorUserId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
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
      const deduction = await deductStockForSales(tx, {
        organizationId: input.organizationId,
        items: invoice.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          warehouseId: undefined,
        })),
        referenceType: 'INVOICE',
        referenceId: invoice.id,
        invoiceId: invoice.id,
        actorId: input.actorUserId ?? undefined,
        notes: `Invoice ${invoice.invoiceNumber} posted`,
      });
      if (!deduction.success) return deduction;
      // Mirror historical display rows for backward compatibility.
      for (const movement of deduction.data ?? []) {
        await tx.invoiceStockMovement.create({
          data: {
            organizationId: input.organizationId,
            invoiceId: invoice.id,
            productId: movement.productId,
            warehouseId: movement.warehouseId,
            quantity: movement.quantity,
          },
        });
      }
    }

    const updated = await tx.invoice.updateMany({
      where: { id: invoice.id, organizationId: input.organizationId, status: 'DRAFT', inventoryDeducted: false },
      data: {
        status: 'SENT',
        issueDate,
        dueDate: input.dueDate,
        inventoryDeducted: input.enabledModules.includes('inventory'),
      },
    });
    if (updated.count !== 1) {
      return { success: false, error: 'Invoice status changed during issue. Please retry.' } as const;
    }
    return { success: true } as const;
  });
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
      // Reverse the original deduction with compensating SALES_RETURN ledger
      // entries (immutable history); physical stock is restored now via the
      // ledger. InvoiceStockMovement rows remain display-only history.
      const salesDeductions = await tx.stockMovement.findMany({
        where: { organizationId: input.organizationId, invoiceId: invoice.id, movementType: 'SALES_DEDUCTION' },
      });
      for (const movement of salesDeductions) {
        const reversal = await applyStockDelta(tx, {
          organizationId: input.organizationId,
          productId: movement.productId,
          warehouseId: movement.warehouseId,
          delta: Math.abs(movement.quantity),
          movementType: 'SALES_RETURN',
          referenceType: 'INVOICE_CANCEL',
          referenceId: invoice.id,
          invoiceId: invoice.id,
          notes: `Sales return for cancelled invoice ${invoice.invoiceNumber}`,
        });
        if (!reversal.success) return reversal;
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
function startOfDay(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
}
