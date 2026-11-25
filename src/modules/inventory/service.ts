import { Prisma, type StockItem, type StockReservation } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import type {
  StockAdjustmentType,
  StockMovementFilters,
  StockMovementType,
  StockBalance,
  StockReservationStatus,
  ServiceResult,
} from './types';

/**
 * Locks the StockItem row FOR UPDATE inside the transaction so concurrent
 * operations on the same product/warehouse are serialized.
 */
async function lockStockItem(
  tx: Prisma.TransactionClient,
  productId: string,
  warehouseId: string,
): Promise<StockItem | null> {
  await tx.$queryRaw`SELECT id FROM "StockItem" WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId} FOR UPDATE`;
  return tx.stockItem.findFirst({ where: { productId, warehouseId } });
}

async function recordInventoryAudit(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorUserId?: string | null;
    targetType: string;
    targetId: string;
    action: string;
    after?: Prisma.InputJsonValue;
  },
) {
  if (!input.actorUserId) return;
  await tx.securityAuditLog.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      after: input.after,
    },
  });
}

async function assertInventoryScope(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  warehouseId: string,
): Promise<{ success: true; productName: string } | { success: false; error: string }> {
  const [product, warehouse] = await Promise.all([
    tx.product.findFirst({ where: { id: productId, organizationId }, select: { id: true, name: true } }),
    tx.warehouse.findFirst({ where: { id: warehouseId, organizationId }, select: { id: true } }),
  ]);
  if (!product) return { success: false, error: 'Product not found in this organization.' };
  if (!warehouse) return { success: false, error: 'Warehouse not found in this organization.' };
  return { success: true, productName: product.name };
}

/** Atomic, validated stock balance change + immutable ledger entry. */
export async function applyStockDelta(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId: string;
    warehouseId: string;
    delta: number;
    movementType: StockMovementType;
    referenceType: string;
    referenceId: string;
    referenceNumber?: string | null;
    invoiceId?: string | null;
    notes?: string | null;
    unitCost?: number | null;
    createdById?: string | null;
  },
): Promise<ServiceResult<{ stock: StockItem }>> {
  const scope = await assertInventoryScope(tx, input.organizationId, input.productId, input.warehouseId);
  if (!scope.success) return scope;

  const stock = await lockStockItem(tx, input.productId, input.warehouseId);
  if (!stock) {
    return { success: false, error: `No stock record for product ${scope.productName} in the selected warehouse.` };
  }
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    return { success: false, error: 'Stock delta must be a non-zero whole number.' };
  }
  const newQuantity = stock.quantity + input.delta;
  if (newQuantity < 0) {
    return {
      success: false,
      error: `Insufficient stock for product ${input.productId} in warehouse ${input.warehouseId}: available ${stock.quantity}, requested ${Math.abs(input.delta)}.`,
    };
  }
  await tx.stockItem.update({ where: { id: stock.id }, data: { quantity: newQuantity } });
  await tx.stockMovement.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: input.movementType,
      quantity: input.delta,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber ?? null,
      invoiceId: input.invoiceId ?? null,
      previousQuantity: stock.quantity,
      newQuantity,
      notes: input.notes ?? null,
      unitCost: input.unitCost != null ? new Prisma.Decimal(input.unitCost) : null,
      createdById: input.createdById ?? null,
    },
  });
  await recordInventoryAudit(tx, {
    organizationId: input.organizationId,
    actorUserId: input.createdById,
    targetType: 'STOCK_ITEM',
    targetId: `${input.productId}:${input.warehouseId}`,
    action: input.movementType,
    after: { previousQuantity: stock.quantity, newQuantity, delta: input.delta, referenceType: input.referenceType, referenceId: input.referenceId },
  });
  return { success: true, data: { stock: await tx.stockItem.findFirstOrThrow({ where: { id: stock.id } }) } };
}

/** Low-level movement insert (used by createProduct for OPENING_STOCK). */
export async function createStockMovementRow(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId: string;
    warehouseId: string;
    movementType: StockMovementType;
    quantity: number;
    referenceType: string;
    referenceId: string;
    referenceNumber?: string | null;
    previousQuantity?: number | null;
    newQuantity?: number | null;
    notes?: string | null;
    createdById?: string | null;
  },
) {
  return tx.stockMovement.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: input.movementType,
      quantity: input.quantity,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber ?? null,
      previousQuantity: input.previousQuantity ?? null,
      newQuantity: input.newQuantity ?? null,
      notes: input.notes ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

export async function recordOpeningStock(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; productId: string; warehouseId: string; quantity: number; createdById?: string | null },
) {
  return createStockMovementRow(tx, {
    ...input,
    movementType: 'OPENING_STOCK',
    referenceType: 'LEGACY_STOCK',
    referenceId: `StockItem:${input.productId}:${input.warehouseId}`,
    previousQuantity: input.quantity,
    newQuantity: input.quantity,
  });
}

export async function getStockBalance(
  organizationId: string,
  productId: string,
  warehouseId: string,
): Promise<StockBalance> {
  const [stock, reserved] = await Promise.all([
    prisma.stockItem.findFirst({ where: { productId, warehouseId } }),
    prisma.stockReservation.aggregate({
      where: { organizationId, productId, warehouseId, status: 'ACTIVE' },
      _sum: { reservedQuantity: true },
    }),
  ]);
  const physical = stock?.quantity ?? 0;
  const activeReserved = reserved._sum.reservedQuantity ?? 0;
  return {
    stockId: stock?.id ?? null,
    productId,
    warehouseId,
    physical,
    activeReserved,
    available: physical - activeReserved,
  };
}

function validateQuantity(quantity: number, label: string): string | null {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return `${label} must be a positive whole number.`;
  }
  return null;
}

/**
 * Deducts physical stock for a sales invoice posting. Validates against
 * available stock (physical - active reservations) and consumes matching
 * ACTIVE reservations. Used by the sales-purchase invoice workflow.
 */
export async function deductStockForSales(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    items: Array<{ productId: string; quantity: number; warehouseId?: string }>;
    referenceType: string;
    referenceId: string;
    invoiceId?: string;
    actorId?: string;
    notes?: string;
  },
): Promise<ServiceResult<Array<{ productId: string; warehouseId: string; quantity: number; movementId: string }>>> {
  if (!input.items.length) return { success: true, data: [] };

  const movements: Array<{ productId: string; warehouseId: string; quantity: number; movementId: string }> = [];

  for (const item of input.items) {
    const quantityError = validateQuantity(item.quantity, `Requested quantity for product ${item.productId}`);
    if (quantityError) return { success: false, error: quantityError };

    const product = await tx.product.findFirst({
      where: { id: item.productId, organizationId: input.organizationId },
      select: { id: true, name: true },
    });
    if (!product) {
      return { success: false, error: 'Product not found in this organization.' };
    }

    let stock: StockItem | null = null;
    if (item.warehouseId) {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: item.warehouseId, organizationId: input.organizationId },
        select: { id: true, name: true },
      });
      if (!warehouse) return { success: false, error: 'Warehouse not found in this organization.' };
      stock = await lockStockItem(tx, item.productId, item.warehouseId);
    } else {
      const candidate = await tx.stockItem.findFirst({
        where: { productId: item.productId, warehouse: { organizationId: input.organizationId } },
        orderBy: { quantity: 'desc' },
      });
      if (candidate) {
        stock = await lockStockItem(tx, item.productId, candidate.warehouseId);
      }
    }
    if (!stock) {
      return { success: false, error: `Product ${product.name} has no available stock.` };
    }

    const reserved = await tx.stockReservation.aggregate({
      where: { organizationId: input.organizationId, productId: stock.productId, warehouseId: stock.warehouseId, status: 'ACTIVE' },
      _sum: { reservedQuantity: true },
    });
    const available = stock.quantity - (reserved._sum.reservedQuantity ?? 0);
    if (available < item.quantity) {
      const product = await tx.product.findFirst({ where: { id: stock.productId } });
      const warehouse = await tx.warehouse.findFirst({ where: { id: stock.warehouseId } });
      return {
        success: false,
        error: `Insufficient stock for product ${product?.name ?? stock.productId} in warehouse ${warehouse?.name ?? stock.warehouseId}: available ${available}, requested ${item.quantity}.`,
      };
    }

    const updated = await tx.stockItem.update({
      where: { id: stock.id },
      data: { quantity: { decrement: item.quantity } },
    });
    const movement = await tx.stockMovement.create({
      data: {
        organizationId: input.organizationId,
        productId: stock.productId,
        warehouseId: stock.warehouseId,
        movementType: 'SALES_DEDUCTION',
        quantity: -item.quantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        invoiceId: input.invoiceId ?? null,
        previousQuantity: stock.quantity,
        newQuantity: updated.quantity,
        notes: input.notes ?? null,
        createdById: input.actorId ?? null,
      },
    });
    movements.push({ productId: stock.productId, warehouseId: stock.warehouseId, quantity: item.quantity, movementId: movement.id });

    // Consume ACTIVE reservations without deducting again (they vouch for
    // this deduction). Idempotent per reservation.
    const activeReservations = await tx.stockReservation.findMany({
      where: { organizationId: input.organizationId, productId: stock.productId, warehouseId: stock.warehouseId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    let remaining = item.quantity;
    for (const reservation of activeReservations) {
      if (remaining <= 0) break;
      const consumedQuantity = Math.min(remaining, reservation.reservedQuantity);
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: 'CONSUMED', consumedAt: new Date(), reservedQuantity: reservation.reservedQuantity - consumedQuantity },
      });
      remaining -= consumedQuantity;
    }
  }
  return { success: true, data: movements };
}

export async function stockIn(input: {
  organizationId: string; productId: string; warehouseId: string; quantity: number; referenceType: string; referenceId: string; createdById?: string; referenceNumber?: string | null; notes?: string | null;
}): Promise<ServiceResult> {
  return prisma.$transaction(async (tx) =>
    applyStockDelta(tx, { ...input, delta: input.quantity, movementType: 'STOCK_IN' }));
}

export async function stockOut(input: {
  organizationId: string; productId: string; warehouseId: string; quantity: number; referenceType: string; referenceId: string; createdById?: string; referenceNumber?: string | null; notes?: string | null;
}): Promise<ServiceResult> {
  return prisma.$transaction(async (tx) =>
    applyStockDelta(tx, { ...input, delta: -input.quantity, movementType: 'STOCK_OUT' }));
}

export async function transferStock(input: {
  organizationId: string; productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; createdById?: string; referenceNumber?: string | null; notes?: string | null;
}): Promise<ServiceResult> {
  if (input.fromWarehouseId === input.toWarehouseId) {
    return { success: false, error: 'Source and destination warehouses must differ.' };
  }
  const transferNumber = `TRF-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  return prisma.$transaction(async (tx) => {
    const scopeFrom = await assertInventoryScope(tx, input.organizationId, input.productId, input.fromWarehouseId);
    if (!scopeFrom.success) return scopeFrom;
    const scopeTo = await tx.warehouse.findFirst({ where: { id: input.toWarehouseId, organizationId: input.organizationId }, select: { id: true } });
    if (!scopeTo) return { success: false, error: 'Destination warehouse not found in this organization.' } as const;

    const source = await lockStockItem(tx, input.productId, input.fromWarehouseId);
    if (!source) {
      return { success: false, error: `Product ${scopeFrom.productName} has no stock in the source warehouse.` } as const;
    }
    if (source.quantity < input.quantity) {
      return {
        success: false,
        error: `Insufficient stock in source warehouse: available ${source.quantity}, requested ${input.quantity}.`,
      } as const;
    }
    const transferOut = await tx.stockItem.update({ where: { id: source.id }, data: { quantity: { decrement: input.quantity } } });
    await tx.stockMovement.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.fromWarehouseId,
        movementType: 'TRANSFER_OUT',
        quantity: -input.quantity,
        referenceType: 'TRANSFER',
        referenceId: transferNumber,
        referenceNumber: input.referenceNumber ?? null,
        previousQuantity: source.quantity,
        newQuantity: transferOut.quantity,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
      },
    });

    const destination = await tx.stockItem.findFirst({ where: { productId: input.productId, warehouseId: input.toWarehouseId } });
    const destQuantity = destination ? destination.quantity + input.quantity : input.quantity;
    await tx.stockItem.upsert({
      where: { productId_warehouseId: { productId: input.productId, warehouseId: input.toWarehouseId } },
      create: { organizationId: input.organizationId, productId: input.productId, warehouseId: input.toWarehouseId, quantity: input.quantity },
      update: { quantity: destQuantity },
    });
    const transferInMovement = await tx.stockMovement.findFirst({ where: { referenceType: 'TRANSFER', referenceId: transferNumber, movementType: 'TRANSFER_OUT' } });
    void transferInMovement;
    await tx.stockMovement.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.toWarehouseId,
        movementType: 'TRANSFER_IN',
        quantity: input.quantity,
        referenceType: 'TRANSFER',
        referenceId: transferNumber,
        referenceNumber: input.referenceNumber ?? null,
        previousQuantity: destination ? destination.quantity : 0,
        newQuantity: destQuantity,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
      },
    });
    return { success: true, data: { referenceId: transferNumber } } as const;
  });
}

export async function adjustStockPosting(input: {
  organizationId: string; productId: string; warehouseId: string; quantity: number; adjustmentType: StockAdjustmentType; reason: string; referenceType: string; referenceId: string; createdById: string; referenceNumber?: string | null; notes?: string | null; approvedById?: string | null; approvedAt?: Date;
}): Promise<ServiceResult> {
  const movementType: StockMovementType = input.adjustmentType === 'INCREASE' ? 'ADJUSTMENT_IN'
    : input.adjustmentType === 'DECREASE' ? 'ADJUSTMENT_OUT'
      : input.adjustmentType === 'COUNT_CORRECTION'
        ? (input.quantity >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT')
        : input.adjustmentType;
  const qtyError = validateQuantity(input.quantity, `Adjustment quantity for product ${input.productId}`);
  if (qtyError && input.adjustmentType !== 'COUNT_CORRECTION') return { success: false, error: qtyError };

  return prisma.$transaction(async (tx) => {
    const scope = await assertInventoryScope(tx, input.organizationId, input.productId, input.warehouseId);
    if (!scope.success) return scope;

    const stock = await lockStockItem(tx, input.productId, input.warehouseId);
    if (!stock) {
      return { success: false, error: `Product ${scope.productName} has no stock in the selected warehouse.` } as const;
    }
    let adjustedQuantity = input.quantity;
    if (input.adjustmentType === 'INCREASE') {
      adjustedQuantity = Math.abs(input.quantity);
    } else if (['DECREASE', 'DAMAGED', 'LOST', 'EXPIRED'].includes(input.adjustmentType)) {
      adjustedQuantity = -Math.abs(input.quantity);
    } else if (input.adjustmentType === 'COUNT_CORRECTION') {
      adjustedQuantity = input.quantity - stock.quantity;
      if (adjustedQuantity === 0) {
        return { success: true, data: { noChange: true } } as const;
      }
    }
    if (adjustedQuantity < 0 && stock.quantity + adjustedQuantity < 0) {
      return { success: false, error: `Cannot decrease stock: available ${stock.quantity}, requested ${Math.abs(adjustedQuantity)}.` } as const;
    }
    const updated = await tx.stockItem.update({
      where: { id: stock.id },
      data: { quantity: { increment: adjustedQuantity } },
    });
    await tx.stockMovement.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        movementType,
        quantity: adjustedQuantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        referenceNumber: input.referenceNumber ?? null,
        previousQuantity: stock.quantity,
        newQuantity: updated.quantity,
        notes: input.notes ?? null,
        createdById: input.createdById,
      },
    });
    await tx.stockAdjustment.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        adjustmentType: input.adjustmentType,
        quantity: adjustedQuantity,
        previousQuantity: stock.quantity,
        newQuantity: updated.quantity,
        reason: input.reason,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById,
        approvedById: input.approvedById ?? null,
        approvedAt: input.approvedAt ?? null,
      },
    });
    return { success: true } as const;
  });
}

export async function reserveStock(input: {
  organizationId: string; productId: string; warehouseId: string; quantity: number; referenceType: string; referenceId: string; createdById: string; referenceNumber?: string | null; notes?: string | null; expiresAt?: Date | null;
}): Promise<ServiceResult<StockReservation>> {
  const quantityError = validateQuantity(input.quantity, `Reservation quantity for product ${input.productId}`);
  if (quantityError) return { success: false, error: quantityError };

  return prisma.$transaction(async (tx) => {
    const scope = await assertInventoryScope(tx, input.organizationId, input.productId, input.warehouseId);
    if (!scope.success) return scope;

    const stock = await lockStockItem(tx, input.productId, input.warehouseId);
    if (!stock) {
      return { success: false, error: `Product ${scope.productName} has no stock in the selected warehouse.` } as const;
    }
    const reserved = await tx.stockReservation.aggregate({
      where: { organizationId: input.organizationId, productId: input.productId, warehouseId: input.warehouseId, status: 'ACTIVE' },
      _sum: { reservedQuantity: true },
    });
    const available = stock.quantity - (reserved._sum.reservedQuantity ?? 0);
    if (available < input.quantity) {
      const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, organizationId: input.organizationId }, select: { name: true } });
      return {
        success: false,
        error: `Insufficient available stock for product ${scope.productName} in warehouse ${warehouse?.name ?? input.warehouseId}: available ${available}, requested ${input.quantity}.`,
      } as const;
    }
    await recordInventoryAudit(tx, {
      organizationId: input.organizationId,
      actorUserId: input.createdById,
      targetType: 'STOCK_RESERVATION',
      targetId: `${input.productId}:${input.warehouseId}`,
      action: 'STOCK_RESERVED',
      after: { quantity: input.quantity, referenceType: input.referenceType, referenceId: input.referenceId },
    });
    const reservation = await tx.stockReservation.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        referenceNumber: input.referenceNumber ?? null,
        reservedQuantity: input.quantity,
        status: 'ACTIVE',
        expiresAt: input.expiresAt ?? null,
        createdById: input.createdById,
        notes: input.notes ?? null,
      },
    });
    return { success: true, data: reservation } as const;
  });
}

export async function releaseReservation(
  organizationId: string,
  reservationId: string,
  actorId: string,
): Promise<ServiceResult> {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.stockReservation.findFirst({
      where: { id: reservationId, organizationId },
    });
    if (!reservation) return { success: false, error: 'Reservation not found.' } as const;
    if (reservation.status !== 'ACTIVE') {
      return { success: false, error: `Reservation is not active (status: ${reservation.status}).` } as const;
    }
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    await recordInventoryAudit(tx, {
      organizationId,
      actorUserId: actorId,
      targetType: 'STOCK_RESERVATION',
      targetId: reservation.id,
      action: 'STOCK_RESERVATION_RELEASED',
      after: { productId: reservation.productId, warehouseId: reservation.warehouseId, quantity: reservation.reservedQuantity },
    });
    await createStockMovementRow(tx, {
      organizationId,
      productId: reservation.productId,
      warehouseId: reservation.warehouseId,
      movementType: 'RESERVATION_RELEASED',
      quantity: reservation.reservedQuantity,
      referenceType: 'STOCK_RESERVATION',
      referenceId: reservation.id,
      referenceNumber: reservation.referenceNumber ?? undefined,
      createdById: actorId,
      notes: 'Released stock reservation.',
    });
    return { success: true } as const;
  });
}

export async function consumeReservation(
  organizationId: string,
  reservationId: string,
  actorId: string,
): Promise<ServiceResult> {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.stockReservation.findFirst({
      where: { id: reservationId, organizationId },
    });
    if (!reservation) return { success: false, error: 'Reservation not found.' } as const;
    if (reservation.status !== 'ACTIVE') {
      return { success: false, error: `Reservation is not active (status: ${reservation.status}); cannot consume.` } as const;
    }
    const deducted = await applyStockDelta(tx, {
      organizationId,
      productId: reservation.productId,
      warehouseId: reservation.warehouseId,
      delta: -reservation.reservedQuantity,
      movementType: 'STOCK_OUT',
      referenceType: 'STOCK_RESERVATION',
      referenceId: reservation.id,
      referenceNumber: reservation.referenceNumber ?? null,
      createdById: actorId,
      notes: 'Consumed stock reservation.',
    });
    if (!deducted.success) return deducted;
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
    await recordInventoryAudit(tx, {
      organizationId,
      actorUserId: actorId,
      targetType: 'STOCK_RESERVATION',
      targetId: reservation.id,
      action: 'STOCK_RESERVATION_CONSUMED',
      after: { productId: reservation.productId, warehouseId: reservation.warehouseId, quantity: reservation.reservedQuantity },
    });
    return { success: true } as const;
  });
}

export async function expireStaleReservations(organizationId?: string): Promise<number> {
  const now = new Date();
  const result = await prisma.stockReservation.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now }, ...(organizationId ? { organizationId } : {}) },
    data: { status: 'EXPIRED', expiredAt: now },
  });
  return result.count;
}

export async function listStockMovements(
  organizationId: string,
  filters: StockMovementFilters & { page?: number; pageSize?: number; search?: string; sort?: 'date_desc' | 'date_asc' | 'quantity_desc' | 'quantity_asc' },
) {
  const { page = 1, pageSize = 50, search, sort, ...where } = filters;
  const whereClause = {
    ...where,
    organizationId,
    ...(search
      ? {
          OR: [
            { referenceNumber: { contains: search, mode: 'insensitive' as const } },
            { referenceId: { contains: search, mode: 'insensitive' as const } },
            { product: { name: { contains: search, mode: 'insensitive' as const } } },
            { product: { sku: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
    ...(where.productId ? { productId: where.productId } : {}),
    ...(where.warehouseId ? { warehouseId: where.warehouseId } : {}),
    ...(where.movementType ? { movementType: where.movementType } : {}),
    ...(where.referenceType ? { referenceType: where.referenceType } : {}),
    ...(where.referenceId ? { referenceId: where.referenceId } : {}),
    ...(where.fromDate || where.toDate
      ? {
          movementDate: {
            ...(where.fromDate ? { gte: where.fromDate } : {}),
            ...(where.toDate ? { lte: where.toDate } : {}),
          },
        }
      : {}),
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where: whereClause,
      include: { product: true, warehouse: true },
      orderBy:
        sort === 'date_asc' ? { movementDate: 'asc' }
          : sort === 'quantity_desc' ? { quantity: 'desc' }
            : sort === 'quantity_asc' ? { quantity: 'asc' }
              : { movementDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockMovement.count({ where: whereClause }),
  ]);
  return { movements, total };
}

export async function listStockReservations(
  organizationId: string,
  filters: { status?: StockReservationStatus; referenceType?: string; referenceId?: string; productId?: string; warehouseId?: string; page?: number; pageSize?: number },
) {
  const { page = 1, pageSize = 50, ...where } = filters;
  const whereClause = {
    organizationId,
    ...(where.status ? { status: where.status } : {}),
    ...(where.referenceType ? { referenceType: where.referenceType } : {}),
    ...(where.referenceId ? { referenceId: where.referenceId } : {}),
    ...(where.productId ? { productId: where.productId } : {}),
    ...(where.warehouseId ? { warehouseId: where.warehouseId } : {}),
  };
  const [reservations, total] = await Promise.all([
    prisma.stockReservation.findMany({
      where: whereClause,
      include: { product: true, warehouse: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockReservation.count({ where: whereClause }),
  ]);
  return { reservations, total };
}

export async function getProductWarehouses(organizationId: string, productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, organizationId } });
  if (!product) return [];
  const stocks = await prisma.stockItem.findMany({
    where: { productId },
    include: { warehouse: true },
    orderBy: { quantity: 'desc' },
  });
  return stocks.map((stock) => ({
    warehouseId: stock.warehouseId,
    warehouseName: stock.warehouse.name,
    quantity: stock.quantity,
  }));
}
