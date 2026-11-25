import assert from 'node:assert/strict';
import 'dotenv/config';
import test from 'node:test';
import { prisma } from '@/core/db/prisma';
import { deductStockForSales, getStockBalance, stockIn } from './service';
import { assertLedgerBalances, cleanupCtx, isDbAvailable, physicalStock, setupCtx } from './stock-test-utils';

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

function sell(ctx: Awaited<ReturnType<typeof setupCtx>>, quantity: number, referenceId: string) {
  return prisma.$transaction((tx) => deductStockForSales(tx, {
    organizationId: ctx.organizationId,
    items: [{ productId: ctx.productId, quantity, warehouseId: ctx.warehouseId }],
    referenceType: 'TEST_SALE',
    referenceId,
    actorId: ctx.userId,
  }));
}

itDb('concurrent sales never oversell the same stock balance', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const [a, b] = await Promise.all([sell(ctx, 7, 'concurrent-sale-a'), sell(ctx, 6, 'concurrent-sale-b')]);
    assert.equal(a.success && b.success, false, 'both concurrent sales must not succeed');
    const successes = [a, b].filter((result) => result.success);
    assert.equal(successes.length, 1);
    const finalStock = await physicalStock(ctx);
    assert.ok(finalStock >= 0);
    assert.equal(finalStock, 10 - successes[0].data![0].quantity);
    const movements = await prisma.stockMovement.findMany({ where: { organizationId: ctx.organizationId, movementType: 'SALES_DEDUCTION' } });
    assert.equal(movements.reduce((sum, movement) => sum + Math.abs(movement.quantity), 0), successes[0].data![0].quantity);
    await assertLedgerBalances(ctx);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('concurrent sales within available quantity both succeed', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const [a, b] = await Promise.all([sell(ctx, 4, 'concurrent-sale-c'), sell(ctx, 4, 'concurrent-sale-d')]);
    assert.equal(a.success, true);
    assert.equal(b.success, true);
    assert.equal(await physicalStock(ctx), 2);
    await assertLedgerBalances(ctx);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('sale beyond available quantity fails without changing stock or ledger', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const result = await sell(ctx, 15, 'oversell');
    assert.equal(result.success, false);
    assert.match(result.error, /product/i);
    assert.equal(await physicalStock(ctx), 10);
    assert.equal(await prisma.stockMovement.count({ where: { organizationId: ctx.organizationId, movementType: 'SALES_DEDUCTION' } }), 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('sale respects active reservations when computing available stock', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    await prisma.stockReservation.create({
      data: {
        organizationId: ctx.organizationId,
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        referenceType: 'SALES_ORDER',
        referenceId: 'order-reserve',
        reservedQuantity: 7,
        status: 'ACTIVE',
        createdById: ctx.userId,
      },
    });
    const result = await sell(ctx, 5, 'sale-after-reserve');
    assert.equal(result.success, false);
    const balance = await getStockBalance(ctx.organizationId, ctx.productId, ctx.warehouseId);
    assert.equal(balance.physical, 10);
    assert.equal(balance.available, 3);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('sales deduction consumes matching active reservations once', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    await prisma.stockReservation.create({
      data: {
        organizationId: ctx.organizationId,
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        referenceType: 'SALES_ORDER',
        referenceId: 'order-consume',
        reservedQuantity: 4,
        status: 'ACTIVE',
        createdById: ctx.userId,
      },
    });
    const result = await sell(ctx, 4, 'sale-consume');
    assert.equal(result.success, true);
    const reservation = await prisma.stockReservation.findFirstOrThrow({ where: { referenceId: 'order-consume' } });
    assert.equal(reservation.status, 'CONSUMED');
    const balance = await getStockBalance(ctx.organizationId, ctx.productId, ctx.warehouseId);
    assert.equal(balance.activeReserved, 0);
    assert.equal(balance.physical, 6);
  } finally {
    await cleanupCtx(ctx);
  }
});
