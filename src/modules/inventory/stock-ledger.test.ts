import assert from 'node:assert/strict';
import 'dotenv/config';
import test from 'node:test';
import { prisma } from '@/core/db/prisma';
import {
  adjustStockPosting,
  applyStockDelta,
  getStockBalance,
  stockIn,
  stockOut,
  transferStock,
} from './service';
import { STOCK_MOVEMENT_TYPES } from './types';
import { assertLedgerBalances, cleanupCtx, isDbAvailable, physicalStock, setupCtx, type TestCtx } from './stock-test-utils';

const itDb = async (name: string, fn: () => Promise<void>) =>
  test(name, async (t) => {
    if (!(await isDbAvailable())) {
      t.skip('Database unavailable');
      return;
    }
    await fn();
  });

async function seedStock(ctx: TestCtx, quantity: number, warehouseId = ctx.warehouseId) {
  const result = await stockIn({
    organizationId: ctx.organizationId,
    productId: ctx.productId,
    warehouseId,
    quantity,
    referenceType: 'STOCK_IN',
    referenceId: `seed-${Date.now()}`,
    createdById: ctx.userId,
  });
  assert.equal(result.success, true);
}

test('movement types are strongly enumerated', () => {
  assert.ok(STOCK_MOVEMENT_TYPES.includes('PURCHASE_RECEIPT'));
  assert.ok(STOCK_MOVEMENT_TYPES.includes('SALES_DEDUCTION'));
  assert.ok(STOCK_MOVEMENT_TYPES.includes('OPENING_STOCK'));
  assert.ok(STOCK_MOVEMENT_TYPES.includes('TRANSFER_IN'));
  assert.ok(STOCK_MOVEMENT_TYPES.includes('RESERVATION_RELEASED'));
});

itDb('stock in creates a movement with correct previous and new balances', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    assert.equal(await physicalStock(ctx), 10);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { organizationId: ctx.organizationId } });
    assert.equal(movement.movementType, 'STOCK_IN');
    assert.equal(movement.quantity, 10);
    assert.equal(movement.previousQuantity, 0);
    assert.equal(movement.newQuantity, 10);
    assert.equal(movement.createdById, ctx.userId);
    await assertLedgerBalances(ctx);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('stock out creates a movement and reduces balance', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const result = await stockOut({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      warehouseId: ctx.warehouseId,
      quantity: 4,
      referenceType: 'STOCK_OUT',
      referenceId: 'issue-1',
      createdById: ctx.userId,
    });
    assert.equal(result.success, true);
    assert.equal(await physicalStock(ctx), 6);
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, movementType: 'STOCK_OUT' },
    });
    assert.equal(movement.quantity, -4);
    assert.equal(movement.previousQuantity, 10);
    assert.equal(movement.newQuantity, 6);
    await assertLedgerBalances(ctx);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('stock out cannot exceed available stock', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 5);
    const result = await stockOut({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      warehouseId: ctx.warehouseId,
      quantity: 8,
      referenceType: 'STOCK_OUT',
      referenceId: 'issue-too-much',
      createdById: ctx.userId,
    });
    assert.equal(result.success, false);
    assert.equal(await physicalStock(ctx), 5);
    assert.equal(await prisma.stockMovement.count({ where: { organizationId: ctx.organizationId, movementType: 'STOCK_OUT' } }), 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('adjustment creates both an adjustment record and a ledger movement', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const result = await adjustStockPosting({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      warehouseId: ctx.warehouseId,
      quantity: 3,
      adjustmentType: 'DAMAGED',
      reason: 'Damaged in transit',
      referenceType: 'STOCK_ADJUSTMENT',
      referenceId: 'adj-1',
      createdById: ctx.userId,
    });
    assert.equal(result.success, true);
    assert.equal(await physicalStock(ctx), 7);
    const adjustment = await prisma.stockAdjustment.findFirstOrThrow({ where: { organizationId: ctx.organizationId } });
    assert.equal(adjustment.adjustmentType, 'DAMAGED');
    assert.equal(adjustment.previousQuantity, 10);
    assert.equal(adjustment.newQuantity, 7);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { movementType: 'DAMAGED' } });
    assert.equal(movement.quantity, -3);
    await assertLedgerBalances(ctx);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('transfer creates two linked movements and updates both warehouses atomically', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 12);
    const result = await transferStock({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      fromWarehouseId: ctx.warehouseId,
      toWarehouseId: ctx.secondWarehouseId,
      quantity: 5,
      createdById: ctx.userId,
    });
    assert.equal(result.success, true);
    assert.equal(await physicalStock(ctx, ctx.warehouseId), 7);
    assert.equal(await physicalStock(ctx, ctx.secondWarehouseId), 5);
    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: ctx.organizationId, movementType: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } },
    });
    assert.equal(movements.length, 2);
    assert.equal(movements[0].referenceId, movements[1].referenceId);
    assert.ok(movements.some((m) => m.movementType === 'TRANSFER_OUT' && m.quantity === -5));
    assert.ok(movements.some((m) => m.movementType === 'TRANSFER_IN' && m.quantity === 5));
    await assertLedgerBalances(ctx);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('transfer fails with insufficient stock and creates no partial movements', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 3);
    const result = await transferStock({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      fromWarehouseId: ctx.warehouseId,
      toWarehouseId: ctx.secondWarehouseId,
      quantity: 5,
      createdById: ctx.userId,
    });
    assert.equal(result.success, false);
    assert.equal(await physicalStock(ctx, ctx.warehouseId), 3);
    assert.equal(await physicalStock(ctx, ctx.secondWarehouseId), 0);
    assert.equal(await prisma.stockMovement.count({ where: { organizationId: ctx.organizationId, movementType: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } } }), 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('getStockBalance reflects physical and reserved stock', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 20);
    await prisma.stockReservation.create({
      data: {
        organizationId: ctx.organizationId,
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        referenceType: 'SALES_ORDER',
        referenceId: 'order-1',
        reservedQuantity: 7,
        status: 'ACTIVE',
        createdById: ctx.userId,
      },
    });
    const balance = await getStockBalance(ctx.organizationId, ctx.productId, ctx.warehouseId);
    assert.equal(balance.physical, 20);
    assert.equal(balance.activeReserved, 7);
    assert.equal(balance.available, 13);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('ledger rows cannot be silently changed by application operations', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { organizationId: ctx.organizationId } });
    const originalQuantity = movement.quantity;
    // Transactions in the engine always INSERT new rows; the application never
    // updates or deletes existing movement records.
    const result = await prisma.$transaction((tx) => applyStockDelta(tx, {
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      warehouseId: ctx.warehouseId,
      delta: -2,
      movementType: 'STOCK_OUT',
      referenceType: 'TEST',
      referenceId: 'test-1',
      createdById: ctx.userId,
    }));
    assert.equal(result.success, true);
    const persisted = await prisma.stockMovement.findFirstOrThrow({ where: { id: movement.id } });
    assert.equal(persisted.quantity, originalQuantity);
  } finally {
    await cleanupCtx(ctx);
  }
});
