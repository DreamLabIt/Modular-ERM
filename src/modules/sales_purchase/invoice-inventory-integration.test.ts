import assert from 'node:assert/strict';
import 'dotenv/config';
import test from 'node:test';
import { prisma } from '@/core/db/prisma';
import { cancelInvoice, createInvoice, issueInvoice } from '@/modules/sales_purchase/model';
import { physicalStock, setupCtx, cleanupCtx, isDbAvailable, assertLedgerBalances } from '@/modules/inventory/stock-test-utils';
import { stockIn } from '@/modules/inventory/service';

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
    referenceId: `inv-seed-${Date.now()}`,
    createdById: ctx.userId,
  });
  assert.equal(result.success, true);
}

itDb('draft invoice does not deduct stock or create a movement', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    // Use a real customer so createInvoice can succeed.
    const customer = await prisma.customer.create({
      data: { organizationId: ctx.organizationId, name: 'Test Customer' },
    });
    const created = await createInvoice({
      organizationId: ctx.organizationId,
      customerId: customer.id,
      productId: ctx.productId,
      quantity: 3,
      taxPercent: 0,
      enabledModules: ['inventory'],
    });
    assert.equal(created.success, true);
    assert.equal(await physicalStock(ctx), 10);
    assert.equal(await prisma.stockMovement.count({ where: { organizationId: ctx.organizationId, movementType: 'SALES_DEDUCTION' } }), 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('posting a draft invoice deducts stock once and creates a ledger movement', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const customer = await prisma.customer.create({ data: { organizationId: ctx.organizationId, name: 'Test Customer' } });
    const created = await createInvoice({
      organizationId: ctx.organizationId,
      customerId: customer.id,
      productId: ctx.productId,
      quantity: 3,
      taxPercent: 0,
      enabledModules: ['inventory'],
    });
    const invoiceId = unwrap(created);
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const issued = await issueInvoice({
      organizationId: ctx.organizationId,
      invoiceId,
      dueDate,
      enabledModules: ['inventory'],
      actorUserId: ctx.userId,
    });
    assert.equal(issued.success, true);
    assert.equal(await physicalStock(ctx), 7);
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, movementType: 'SALES_DEDUCTION' },
    });
    assert.equal(movement.invoiceId, invoiceId);
    assert.equal(movement.quantity, -3);
    assert.equal(movement.previousQuantity, 10);
    assert.equal(movement.newQuantity, 7);
    await assertLedgerBalances(ctx);

    const repeated = await issueInvoice({
      organizationId: ctx.organizationId,
      invoiceId,
      dueDate,
      enabledModules: ['inventory'],
      actorUserId: ctx.userId,
    });
    assert.equal(repeated.success, false);
    assert.equal(await physicalStock(ctx), 7);
    assert.equal(await prisma.stockMovement.count({ where: { invoiceId, movementType: 'SALES_DEDUCTION' } }), 1);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('posting fails with insufficient stock and the invoice stays DRAFT', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 2);
    const customer = await prisma.customer.create({ data: { organizationId: ctx.organizationId, name: 'Test Customer' } });
    const created = await createInvoice({
      organizationId: ctx.organizationId,
      customerId: customer.id,
      productId: ctx.productId,
      quantity: 5,
      taxPercent: 0,
      enabledModules: ['inventory'],
    });
    const invoiceId = unwrap(created);
    const issued = await issueInvoice({
      organizationId: ctx.organizationId,
      invoiceId,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      enabledModules: ['inventory'],
      actorUserId: ctx.userId,
    });
    assert.equal(issued.success, false);
    assert.match(issued.error, /product/i);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.status, 'DRAFT');
    assert.equal(invoice.inventoryDeducted, false);
    assert.equal(await physicalStock(ctx), 2);
    assert.equal(await prisma.stockMovement.count({ where: { organizationId: ctx.organizationId, movementType: 'SALES_DEDUCTION' } }), 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('cancelling a posted invoice creates compensating SALES_RETURN movements', async () => {
  const ctx = await setupCtx();
  try {
    await seedStock(ctx, 10);
    const customer = await prisma.customer.create({ data: { organizationId: ctx.organizationId, name: 'Test Customer' } });
    const created = await createInvoice({
      organizationId: ctx.organizationId,
      customerId: customer.id,
      productId: ctx.productId,
      quantity: 4,
      taxPercent: 0,
      enabledModules: ['inventory'],
    });
    const invoiceId = unwrap(created);
    await issueInvoice({
      organizationId: ctx.organizationId,
      invoiceId,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      enabledModules: ['inventory'],
      actorUserId: ctx.userId,
    });
    const cancelled = await cancelInvoice({
      organizationId: ctx.organizationId,
      invoiceId,
      cancelledById: ctx.userId,
      enabledModules: ['inventory'],
    });
    assert.equal(cancelled.success, true);
    assert.equal(await physicalStock(ctx), 10);
    const returns = await prisma.stockMovement.findMany({ where: { invoiceId, movementType: 'SALES_RETURN' } });
    assert.equal(returns.length, 1);
    assert.equal(returns[0].quantity, 4);
    const original = await prisma.stockMovement.findFirstOrThrow({ where: { invoiceId, movementType: 'SALES_DEDUCTION' } });
    assert.equal(original.quantity, -4, 'original deduction remains immutable');
    await assertLedgerBalances(ctx);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('cross-tenant invoice posting is rejected', async () => {
  const ctxA = await setupCtx('inv-tenant-a');
  const ctxB = await setupCtx('inv-tenant-b');
  try {
    await seedStock(ctxA, 10);
    const customer = await prisma.customer.create({ data: { organizationId: ctxA.organizationId, name: 'Test Customer' } });
    const created = await createInvoice({
      organizationId: ctxA.organizationId,
      customerId: customer.id,
      productId: ctxA.productId,
      quantity: 3,
      taxPercent: 0,
      enabledModules: ['inventory'],
    });
    const issued = await issueInvoice({
      organizationId: ctxB.organizationId,
      invoiceId: unwrap(created),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      enabledModules: ['inventory'],
      actorUserId: ctxB.userId,
    });
    assert.equal(issued.success, false);
    assert.equal(await physicalStock(ctxA), 10);
  } finally {
    await cleanupCtx(ctxA);
    await cleanupCtx(ctxB);
  }
});
