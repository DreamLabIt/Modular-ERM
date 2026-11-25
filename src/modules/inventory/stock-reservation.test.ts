import assert from 'node:assert/strict';
import 'dotenv/config';
import test from 'node:test';
import { prisma } from '@/core/db/prisma';
import {
  consumeReservation,
  expireStaleReservations,
  getStockBalance,
  releaseReservation,
  reserveStock,
  stockIn,
} from './service';
import { assertLedgerBalances, cleanupCtx, isDbAvailable, physicalStock, setupCtx } from './stock-test-utils';

function unwrap<T>(result: { success: true; data?: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  if (result.data === undefined) throw new Error('Missing result data');
  return result.data;
}

const itDb = async (name: string, fn: () => Promise<void>) =>
  test(name, async (t) => {
    if (!(await isDbAvailable())) {
      t.skip('Database unavailable');
      return;
    }
    await fn();
  });

async function seedStock(ctx: Awaited<ReturnType<typeof setupCtx>>, quantity: number) {
  const result = await stockIn({
    organizationId: ctx.organizationId,
    productId: ctx.productId,
    warehouseId: ctx.warehouseId,
    quantity,
    referenceType: 'STOCK_IN',
    referenceId: `seed-${Date.now()}`,
    createdById: ctx.userId,
  });
  assert.equal(result.success, true);
}

itDb('reservation succeeds with sufficient availability and does not move physical stock', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const result = await reserveStock({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      warehouseId: ctx.warehouseId,
      quantity: 4,
      referenceType: 'SALES_ORDER',
      referenceId: 'order-1',
      createdById: ctx.userId,
    });
    assert.equal(result.success, true);
    const balance = await getStockBalance(ctx.organizationId, ctx.productId, ctx.warehouseId);
    assert.equal(balance.physical, 10);
    assert.equal(balance.activeReserved, 4);
    assert.equal(balance.available, 6);
    assert.equal(await physicalStock(ctx), 10);
    const movements = await prisma.stockMovement.findMany({ where: { organizationId: ctx.organizationId } });
    assert.equal(movements.filter((m) => m.movementType === 'STOCK_OUT').length, 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('over-reservation fails and creates no reservation', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const result = await reserveStock({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      warehouseId: ctx.warehouseId,
      quantity: 12,
      referenceType: 'SALES_ORDER',
      referenceId: 'order-2',
      createdById: ctx.userId,
    });
    assert.equal(result.success, false);
    assert.equal(await prisma.stockReservation.count({ where: { organizationId: ctx.organizationId } }), 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('release restores available stock and prevents duplicate release', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const reserved = await reserveStock({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      warehouseId: ctx.warehouseId,
      quantity: 4,
      referenceType: 'SALES_ORDER',
      referenceId: 'order-3',
      createdById: ctx.userId,
    });
    const reservationId = unwrap(reserved).id;
    const release = await releaseReservation(ctx.organizationId, reservationId, ctx.userId);
    assert.equal(release.success, true);
    const duplicate = await releaseReservation(ctx.organizationId, reservationId, ctx.userId);
    assert.equal(duplicate.success, false);
    const balance = await getStockBalance(ctx.organizationId, ctx.productId, ctx.warehouseId);
    assert.equal(balance.available, 10);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('consume reservation deducts physical stock exactly once', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const reserved = await reserveStock({
      organizationId: ctx.organizationId,
      productId: ctx.productId,
      warehouseId: ctx.warehouseId,
      quantity: 4,
      referenceType: 'SALES_ORDER',
      referenceId: 'order-4',
      createdById: ctx.userId,
    });
    const reservationId = unwrap(reserved).id;
    const consume = await consumeReservation(ctx.organizationId, reservationId, ctx.userId);
    assert.equal(consume.success, true);
    assert.equal(await physicalStock(ctx), 6);
    const repeat = await consumeReservation(ctx.organizationId, reservationId, ctx.userId);
    assert.equal(repeat.success, false);
    assert.equal(await physicalStock(ctx), 6);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { movementType: 'STOCK_OUT' } });
    assert.equal(movement.quantity, -4);
    await assertLedgerBalances(ctx);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('expired reservations are released idempotently and cannot be consumed', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    await prisma.stockReservation.create({
      data: {
        organizationId: ctx.organizationId,
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        referenceType: 'SALES_ORDER',
        referenceId: 'order-expired',
        reservedQuantity: 5,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 60_000),
        createdById: ctx.userId,
      },
    });
    const count = await expireStaleReservations(ctx.organizationId);
    assert.equal(count, 1);
    const again = await expireStaleReservations(ctx.organizationId);
    assert.equal(again, 0);
    const reservation = await prisma.stockReservation.findFirstOrThrow({ where: { referenceId: 'order-expired' } });
    assert.equal(reservation.status, 'EXPIRED');
    const consume = await consumeReservation(ctx.organizationId, reservation.id, ctx.userId);
    assert.equal(consume.success, false);
    assert.equal(await physicalStock(ctx), 10);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('concurrent reservations cannot exceed available stock', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const results = await Promise.all([
      reserveStock({ organizationId: ctx.organizationId, productId: ctx.productId, warehouseId: ctx.warehouseId, quantity: 7, referenceType: 'SALES_ORDER', referenceId: 'concurrent-a', createdById: ctx.userId }),
      reserveStock({ organizationId: ctx.organizationId, productId: ctx.productId, warehouseId: ctx.warehouseId, quantity: 6, referenceType: 'SALES_ORDER', referenceId: 'concurrent-b', createdById: ctx.userId }),
    ]);
    const successes = results.filter((result) => result.success);
    assert.equal(successes.length, 1);
    const balance = await getStockBalance(ctx.organizationId, ctx.productId, ctx.warehouseId);
    assert.equal(balance.activeReserved, successes[0].data!.reservedQuantity);
    assert.ok(balance.available >= 0);
  } finally {
    await cleanupCtx(ctx);
  }
});
