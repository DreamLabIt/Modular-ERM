import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import type { CreateGoodsReceiptInput, GoodsReceiptInputItem } from '@/core/types';
import {
  calculateRemainingQuantity,
  isPurchaseOrderStatus,
  isValidPurchaseOrderTransition,
  type PurchaseOrderStatus,
} from './workflow';
import { createReceiptNumber, createSecurityAuditLog } from './model';

type LifecycleResult =
  | { success: true; data?: { id: string } }
  | { success: false; error: string };

/**
 * Locks the Purchase Order row FOR UPDATE inside the transaction so that two
 * concurrent operations cannot both read the same "remaining" quantity.
 * Returns the latest Purchase Order row after the lock is acquired.
 */
async function lockPurchaseOrder(
  tx: Prisma.TransactionClient,
  organizationId: string,
  purchaseOrderId: string,
) {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  return tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId } });
}

function assertStatus(po: { status: string }): PurchaseOrderStatus {
  if (!isPurchaseOrderStatus(po.status)) {
    throw new Error(`Unexpected Purchase Order status: ${po.status}`);
  }
  return po.status;
}

/** Shared quantity validation for goods receipt lines. */
export function validateGoodsReceiptItems(items: GoodsReceiptInputItem[]): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return 'Enter at least one receipt line.';
  }
  const seen = new Set<string>();
  let totalReceived = 0;
  for (const item of items) {
    if (!Number.isInteger(item.receivedQuantity) || item.receivedQuantity < 0) {
      return 'Received quantities must be whole numbers.';
    }
    if (!Number.isInteger(item.acceptedQuantity) || item.acceptedQuantity < 0 ||
        !Number.isInteger(item.rejectedQuantity) || item.rejectedQuantity < 0) {
      return 'Accepted and rejected quantities must be whole numbers.';
    }
    if (item.acceptedQuantity + item.rejectedQuantity !== item.receivedQuantity) {
      return 'Received quantity must equal accepted + rejected.';
    }
    if (!(item.unitCost > 0)) {
      return 'Unit cost must be positive.';
    }
    if (seen.has(item.purchaseOrderItemId)) {
      return 'Each purchase order item can appear once in the GRN.';
    }
    seen.add(item.purchaseOrderItemId);
    totalReceived += item.receivedQuantity;
  }
  if (totalReceived <= 0) {
    return 'At least one quantity must be received.';
  }
  return null;
}

export async function submitPurchaseOrderForApproval(input: {
  organizationId: string;
  purchaseOrderId: string;
  actorUserId: string;
}): Promise<LifecycleResult> {
  return prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, input.organizationId, input.purchaseOrderId);
    if (!po) return { success: false, error: 'Purchase Order not found.' };
    const current = assertStatus(po);

    const target: PurchaseOrderStatus = 'PENDING_APPROVAL';
    if (!isValidPurchaseOrderTransition(current, target)) {
      return { success: false, error: `The Purchase Order is already ${current}; only DRAFT orders can be submitted for approval.` };
    }

    const before = current;
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: target } });
    await tx.purchaseOrderApproval.create({
      data: { organizationId: input.organizationId, purchaseOrderId: po.id, action: 'SUBMITTED_FOR_APPROVAL' },
    });
    await createSecurityAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: 'PURCHASE_ORDER',
      targetId: po.id,
      action: 'PO_SUBMITTED_FOR_APPROVAL',
      before,
      after: target,
    });
    return { success: true, data: { id: po.id } };
  });
}

export async function approvePurchaseOrder(input: {
  organizationId: string;
  purchaseOrderId: string;
  actorUserId: string;
}): Promise<LifecycleResult> {
  return prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, input.organizationId, input.purchaseOrderId);
    if (!po) return { success: false, error: 'Purchase Order not found.' };
    const current = assertStatus(po);

    const target: PurchaseOrderStatus = 'APPROVED';
    if (!isValidPurchaseOrderTransition(current, target)) {
      return { success: false, error: `Invalid transition from ${current} to APPROVED.` };
    }
    if (current === target) {
      return { success: false, error: 'The Purchase Order is already approved.' };
    }

    const before = current;
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: target, approvedById: input.actorUserId, approvedAt: new Date() },
    });
    await tx.purchaseOrderApproval.create({
      data: {
        organizationId: input.organizationId,
        purchaseOrderId: po.id,
        action: 'APPROVED',
        approvedById: input.actorUserId,
      },
    });
    await createSecurityAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: 'PURCHASE_ORDER',
      targetId: po.id,
      action: 'PO_APPROVED',
      before,
      after: target,
    });
    return { success: true, data: { id: po.id } };
  });
}

export async function rejectPurchaseOrder(input: {
  organizationId: string;
  purchaseOrderId: string;
  actorUserId: string;
  reason: string;
}): Promise<LifecycleResult> {
  const reason = input.reason.trim();
  return prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, input.organizationId, input.purchaseOrderId);
    if (!po) return { success: false, error: 'Purchase Order not found.' };
    const current = assertStatus(po);

    const target: PurchaseOrderStatus = 'REJECTED';
    if (!isValidPurchaseOrderTransition(current, target)) {
      return { success: false, error: `The Purchase Order is ${current} and cannot be rejected.` };
    }

    const before = current;
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: target, rejectionReason: reason || null },
    });
    await tx.purchaseOrderApproval.create({
      data: {
        organizationId: input.organizationId,
        purchaseOrderId: po.id,
        action: 'REJECTED',
        approvedById: input.actorUserId,
        rejectedReason: reason || null,
      },
    });
    await createSecurityAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: 'PURCHASE_ORDER',
      targetId: po.id,
      action: 'PO_REJECTED',
      before,
      after: target,
    });
    return { success: true, data: { id: po.id } };
  });
}

export async function sendPurchaseOrder(input: {
  organizationId: string;
  purchaseOrderId: string;
  actorUserId: string;
}): Promise<LifecycleResult> {
  return prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, input.organizationId, input.purchaseOrderId);
    if (!po) return { success: false, error: 'Purchase Order not found.' };
    const current = assertStatus(po);

    const target: PurchaseOrderStatus = 'SENT';
    if (!isValidPurchaseOrderTransition(current, target)) {
      return { success: false, error: `Invalid transition from ${current} to SENT.` };
    }

    const before = current;
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: target } });
    await createSecurityAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: 'PURCHASE_ORDER',
      targetId: po.id,
      action: 'PO_SENT',
      before,
      after: target,
    });
    return { success: true, data: { id: po.id } };
  });
}

export async function cancelPurchaseOrder(input: {
  organizationId: string;
  purchaseOrderId: string;
  actorUserId: string;
  reason: string;
}): Promise<LifecycleResult> {
  const reason = input.reason.trim();
  return prisma.$transaction(async (tx) => {
    const po = await lockPurchaseOrder(tx, input.organizationId, input.purchaseOrderId);
    if (!po) return { success: false, error: 'Purchase Order not found.' };
    const current = assertStatus(po);

    const target: PurchaseOrderStatus = 'CANCELLED';
    if (!isValidPurchaseOrderTransition(current, target)) {
      return { success: false, error: `The Purchase Order is ${current} and cannot be cancelled.` };
    }

    const before = current;
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: target, cancellationReason: reason || null, cancelledAt: new Date() },
    });
    await createSecurityAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: 'PURCHASE_ORDER',
      targetId: po.id,
      action: 'PO_CANCELLED',
      before,
      after: target,
    });
    return { success: true, data: { id: po.id } };
  });
}

export async function createGoodsReceipt(input: CreateGoodsReceiptInput & {
  enabledModules: string[];
}) {
  const itemError = validateGoodsReceiptItems(input.items);
  if (itemError) return { success: false, error: itemError } as const;

  return prisma.$transaction(async (tx) => {
    // Idempotent retry: the same idempotency key returns the existing receipt
    // without touching stock again.
    if (input.idempotencyKey) {
      const existing = await tx.goodsReceipt.findFirst({
        where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { success: true, duplicate: true, receiptId: existing.id } as const;
    }

    const po = await lockPurchaseOrder(tx, input.organizationId, input.purchaseOrderId);
    if (!po) return { success: false, error: 'Purchase Order not found.' } as const;
    const current = assertStatus(po);

    // Goods may only be received from non-terminal Purchase Orders.
    if (!['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(current)) {
      return { success: false, error: `Goods cannot be received: the Purchase Order is ${current}.` } as const;
    }

    const warehouse = await tx.warehouse.findFirst({
      where: { id: input.warehouseId, organizationId: input.organizationId },
    });
    if (!warehouse) {
      return { success: false, error: 'Warehouse does not belong to this organization.' } as const;
    }

    const poItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
    const poItemById = new Map(poItems.map((item) => [item.id, item]));

    const receiptNumber = createReceiptNumber();
    const receiptItemData: Array<{
      purchaseOrderItemId: string;
      productId: string;
      orderedQuantity: number;
      previouslyReceived: number;
      receivedQuantity: number;
      acceptedQuantity: number;
      rejectedQuantity: number;
      unitCost: Prisma.Decimal;
      notes: string | null;
    }> = [];
    const stockMovements: Array<{
      organizationId: string;
      productId: string;
      warehouseId: string;
      movementType: string;
      quantity: number;
      referenceType: string;
      referenceId: string;
      goodsReceiptId?: string;
      purchaseOrderId: string;
      unitCost: Prisma.Decimal;
      createdById: string;
    }> = [];
    let totalAcceptedAmount = new Prisma.Decimal(0);

    for (const item of input.items) {
      const poItem = poItemById.get(item.purchaseOrderItemId);
      if (!poItem) {
        return { success: false, error: `Purchase order item ${item.purchaseOrderItemId} does not belong to this Purchase Order.` } as const;
      }
      const product = await tx.product.findFirst({ where: { id: poItem.productId } });
      if (!product || product.organizationId !== input.organizationId) {
        return { success: false, error: 'Product does not belong to this organization.' } as const;
      }

      const unitCost = new Prisma.Decimal(item.unitCost);
      const remaining = calculateRemainingQuantity(poItem.orderedQuantity, poItem.previouslyReceived);
      if (item.receivedQuantity > remaining) {
        return { success: false, error: `Cannot receive more than the remaining quantity of ${remaining} for product ${product.name}.` } as const;
      }

      receiptItemData.push({
        purchaseOrderItemId: poItem.id,
        productId: poItem.productId,
        orderedQuantity: poItem.orderedQuantity,
        previouslyReceived: poItem.previouslyReceived,
        receivedQuantity: item.receivedQuantity,
        acceptedQuantity: item.acceptedQuantity,
        rejectedQuantity: item.rejectedQuantity,
        unitCost,
        notes: item.notes ?? null,
      });

      if (item.acceptedQuantity > 0) {
        totalAcceptedAmount = totalAcceptedAmount.plus(unitCost.mul(item.acceptedQuantity));
        stockMovements.push({
          organizationId: input.organizationId,
          productId: poItem.productId,
          warehouseId: input.warehouseId,
          movementType: 'PURCHASE_RECEIPT',
          quantity: item.acceptedQuantity,
          referenceType: 'GOODS_RECEIPT',
          referenceId: receiptNumber,
          purchaseOrderId: po.id,
          unitCost,
          createdById: input.receivedById,
        });
      }
    }

    const grn = await tx.goodsReceipt.create({
      data: {
        organizationId: input.organizationId,
        purchaseOrderId: po.id,
        receiptNumber,
        warehouseId: input.warehouseId,
        receivedDate: input.receivedDate ?? new Date(),
        notes: input.notes ?? null,
        receivedById: input.receivedById,
        idempotencyKey: input.idempotencyKey ?? null,
        items: { create: receiptItemData },
      },
      include: { items: true },
    });

    // Stock increases ONLY for accepted quantities.
    for (const grnItem of grn.items) {
      const poItem = poItemById.get(grnItem.purchaseOrderItemId)!;
      await tx.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: { previouslyReceived: poItem.previouslyReceived + grnItem.acceptedQuantity },
      });
      if (grnItem.acceptedQuantity > 0) {
        const stock = await tx.stockItem.findFirst({
          where: { productId: grnItem.productId, warehouseId: input.warehouseId },
        });
        if (stock) {
          await tx.stockItem.update({
            where: { id: stock.id },
            data: { quantity: { increment: grnItem.acceptedQuantity } },
          });
        } else {
          await tx.stockItem.create({
            data: {
              productId: grnItem.productId,
              warehouseId: input.warehouseId,
              quantity: grnItem.acceptedQuantity,
            },
          });
        }
      }
    }

    // Stock movements are only created for accepted quantities.
    for (const movement of stockMovements) {
      movement.goodsReceiptId = grn.id;
      await tx.stockMovement.create({ data: movement });
    }

    // Update the Purchase Order status from the freshly accumulated receipts.
    const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
    const allFullyReceived = updatedItems.every((item) => item.previouslyReceived >= item.orderedQuantity);
    const poStatusWas = current;
    const poData: { status: PurchaseOrderStatus; receivedDate?: Date } = allFullyReceived
      ? { status: 'RECEIVED', receivedDate: new Date() }
      : poStatusWas === 'SENT' || poStatusWas === 'APPROVED'
        ? { status: 'PARTIALLY_RECEIVED' }
        : { status: poStatusWas };
    await tx.purchaseOrder.update({ where: { id: po.id }, data: poData });

    // Accounting: record the actual receipt event. The goods themselves are
    // never booked as a completed purchase or payment; supplier invoices and
    // payments are separate business events.
    if (input.enabledModules.includes('accounting')) {
      await tx.accountTransaction.create({
        data: {
          organizationId: input.organizationId,
          type: 'EXPENSE',
          category: 'Inventory Purchase',
          reference: grn.receiptNumber,
          description: `Goods Receipt ${grn.receiptNumber} for Purchase Order ${po.poNumber}`,
          amount: totalAcceptedAmount,
        },
      });
    }

    await createSecurityAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.receivedById,
      targetType: 'GOODS_RECEIPT',
      targetId: grn.id,
      action: 'GRN_CREATED',
      after: {
        receiptNumber: grn.receiptNumber,
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        items: grn.items.map((item) => ({
          productId: item.productId,
          acceptedQuantity: item.acceptedQuantity,
          rejectedQuantity: item.rejectedQuantity,
        })),
      },
    });
    if (poData.status === 'RECEIVED') {
      await createSecurityAuditLog(tx, {
        organizationId: input.organizationId,
        actorUserId: input.receivedById,
        targetType: 'PURCHASE_ORDER',
        targetId: po.id,
        action: 'PO_RECEIVED',
        before: poStatusWas,
        after: 'RECEIVED',
      });
    } else if (poStatusWas !== 'PARTIALLY_RECEIVED') {
      await createSecurityAuditLog(tx, {
        organizationId: input.organizationId,
        actorUserId: input.receivedById,
        targetType: 'PURCHASE_ORDER',
        targetId: po.id,
        action: 'PO_PARTIALLY_RECEIVED',
        before: poStatusWas,
        after: poData.status,
      });
    }

    return { success: true, duplicate: false, receiptId: grn.id } as const;
  });
}

export async function getStockMovementsForGoodsReceipt(organizationId: string, goodsReceiptId: string) {
  return prisma.stockMovement.findMany({
    where: { organizationId, goodsReceiptId },
    orderBy: { productId: 'asc' },
    include: { product: true, warehouse: true },
  });
}
