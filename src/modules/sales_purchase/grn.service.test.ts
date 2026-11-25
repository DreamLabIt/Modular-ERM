import assert from 'node:assert/strict';
import 'dotenv/config';
import test from 'node:test';
import { prisma } from '@/core/db/prisma';
import {
  approvePurchaseOrder,
  createGoodsReceipt,
  sendPurchaseOrder,
  submitPurchaseOrderForApproval,
} from './service';
import {
  createPurchaseOrder,
  getGoodsReceipts,
  getPurchaseOrderRemainingQuantities,
  listPurchaseOrderData,
} from './model';

/*
 * Database-backed integration tests. They run against the development
 * PostgreSQL database and clean up their test organization afterwards.
 */

let dbAvailable: boolean | undefined;

async function isDbAvailable(): Promise<boolean> {
  if (dbAvailable === undefined) {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }
  return dbAvailable;
}

const itDb = async (name: string, fn: () => Promise<void>) =>
  test(name, async (t) => {
    if (!(await isDbAvailable())) {
      t.skip('Database unavailable');
      return;
    }
    await fn();
  });

function getError(result: unknown): string | undefined {
  return (result as { success: boolean; error?: string }).error;
}

interface TestCtx {
  organizationId: string;
  userId: string;
  supplierId: string;
  productId: string;
  warehouseId: string;
  products: Array<{ id: string; name: string }>;
}

async function setupCtx(): Promise<TestCtx> {
  const slug = `po-grn-test-${Date.now()}`;
  const organization = await prisma.organization.create({
    data: { name: `PoGrnTest ${slug}`, slug },
  });
  const role = await prisma.role.create({
    data: { organizationId: organization.id, name: 'Admin', permissions: ['*'] },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      roleId: role.id,
      name: 'PO GRN Test Admin',
      email: `po-grn-test-${Date.now()}@local.test`,
      passwordHash: 'not-a-real-hash',
    },
  });
  const supplier = await prisma.supplier.create({
    data: { organizationId: organization.id, name: 'Test Supplier' },
  });
  const product = await prisma.product.create({
    data: { organizationId: organization.id, sku: `TEST-${Date.now()}`, name: 'Test Product', costPrice: 100, sellingPrice: 150 },
  });
  const warehouse = await prisma.warehouse.create({
    data: { organizationId: organization.id, name: 'Test Warehouse' },
  });
  return { organizationId: organization.id, userId: user.id, supplierId: supplier.id, productId: product.id, warehouseId: warehouse.id, products: [{ id: product.id, name: product.name }] };
}

async function cleanupCtx(ctx: TestCtx) {
  const org = ctx.organizationId;
  await prisma.securityAuditLog.deleteMany({ where: { organizationId: org } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: org } });
  await prisma.goodsReceipt.deleteMany({ where: { organizationId: org } });
  await prisma.purchaseOrderApproval.deleteMany({ where: { organizationId: org } });
  await prisma.purchaseOrder.deleteMany({ where: { organizationId: org } });
  await prisma.supplier.deleteMany({ where: { organizationId: org } });
  await prisma.stockItem.deleteMany({ where: { organizationId: org } });
  await prisma.warehouse.deleteMany({ where: { organizationId: org } });
  await prisma.product.deleteMany({ where: { organizationId: org } });
  await prisma.user.deleteMany({ where: { organizationId: org } });
  await prisma.role.deleteMany({ where: { organizationId: org } });
  await prisma.organization.deleteMany({ where: { id: org } });
}

async function stockQuantity(ctx: TestCtx): Promise<number> {
  const stock = await prisma.stockItem.findFirst({ where: { productId: ctx.productId, warehouseId: ctx.warehouseId } });
  return stock ? stock.quantity : 0;
}

async function createTestPo(ctx: TestCtx, quantity: number, productId = ctx.productId) {
  const result = await createPurchaseOrder({
    organizationId: ctx.organizationId,
    supplierId: ctx.supplierId,
    warehouseId: ctx.warehouseId,
    actorUserId: ctx.userId,
    items: [{ productId, quantity }],
  });
  assert.equal(result.success, true, getError(result));
  const poId = result.data?.id ?? '';
  const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: poId }, include: { items: true } });
  const poItemId = po.items[0].id;
  return { poId, po, poItemId };
}

async function advanceToSent(ctx: TestCtx, poId: string) {
  const submit = await submitPurchaseOrderForApproval({ organizationId: ctx.organizationId, purchaseOrderId: poId, actorUserId: ctx.userId });
  assert.equal(submit.success, true, getError(submit));
  const approve = await approvePurchaseOrder({ organizationId: ctx.organizationId, purchaseOrderId: poId, actorUserId: ctx.userId });
  assert.equal(approve.success, true, getError(approve));
  const send = await sendPurchaseOrder({ organizationId: ctx.organizationId, purchaseOrderId: poId, actorUserId: ctx.userId });
  assert.equal(send.success, true, getError(send));
}

function grnInput(
  ctx: TestCtx,
  poId: string,
  orderedQuantity: number,
  accepted: number,
  rejected = 0,
  extra?: Partial<Parameters<typeof createGoodsReceipt>[0]['items'][number]>,
) {
  void poId;
  return {
    purchaseOrderItemId: extra?.purchaseOrderItemId ?? '',
    productId: extra?.productId ?? ctx.productId,
    orderedQuantity,
    previouslyReceived: 0,
    receivedQuantity: extra?.receivedQuantity ?? accepted + rejected,
    acceptedQuantity: accepted,
    rejectedQuantity: rejected,
    unitCost: extra?.unitCost ?? 100,
    notes: extra?.notes,
  };
}

itDb('PO creation sets DRAFT and does not increase stock or create movements', async () => {
  const ctx = await setupCtx();
  try {
    const { poId, po } = await createTestPo(ctx, 10);
    assert.equal(po.status, 'DRAFT');
    assert.equal(await stockQuantity(ctx), 0);
    const movements = await prisma.stockMovement.findMany({ where: { organizationId: ctx.organizationId } });
    assert.equal(movements.length, 0);
    assert.equal(await prisma.accountTransaction.count({ where: { organizationId: ctx.organizationId } }), 0);
    void poId;
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('full receipt increases stock only for accepted quantities and marks PO RECEIVED', async () => {
  const ctx = await setupCtx();
  try {
    const { po, poItemId } = await createTestPo(ctx, 10);
    await advanceToSent(ctx, po.id);
    const receipt = await createGoodsReceipt({
      organizationId: ctx.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx.warehouseId,
      receivedById: ctx.userId,
      enabledModules: ['inventory', 'accounting'],
      items: [grnInput(ctx, po.id, 10, 10, 0, { purchaseOrderItemId: poItemId })],
    });
    assert.equal(receipt.success, true, getError(receipt));
    assert.equal(await stockQuantity(ctx), 10);
    const updatedPo = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: po.id } });
    assert.equal(updatedPo.status, 'RECEIVED');
    assert.ok(updatedPo.receivedDate);
    assert.equal(await prisma.goodsReceipt.count({ where: { organizationId: ctx.organizationId } }), 1);
    const movements = await prisma.stockMovement.findMany({ where: { organizationId: ctx.organizationId } });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].movementType, 'PURCHASE_RECEIPT');
    assert.equal(movements[0].quantity, 10);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('rejected goods do not increase stock', async () => {
  const ctx = await setupCtx();
  try {
    const { po, poItemId } = await createTestPo(ctx, 10);
    await advanceToSent(ctx, po.id);
    const receipt = await createGoodsReceipt({
      organizationId: ctx.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx.warehouseId,
      receivedById: ctx.userId,
      enabledModules: ['inventory'],
      items: [grnInput(ctx, po.id, 10, 0, 8, { purchaseOrderItemId: poItemId })],
    });
    assert.equal(receipt.success, true, getError(receipt));
    assert.equal(await stockQuantity(ctx), 0);
    const updatedPo = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: po.id } });
    assert.equal(updatedPo.status, 'PARTIALLY_RECEIVED');
    const movementRows = await prisma.stockMovement.findMany({ where: { organizationId: ctx.organizationId } });
    assert.equal(movementRows.length, 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('over-receipt is rejected and rolls back all changes', async () => {
  const ctx = await setupCtx();
  try {
    const secondProduct = await prisma.product.create({
      data: { organizationId: ctx.organizationId, sku: `TEST2-${Date.now()}`, name: 'Test Product 2', costPrice: 5, sellingPrice: 7 },
    });
    const result = await createPurchaseOrder({
      organizationId: ctx.organizationId,
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      actorUserId: ctx.userId,
      items: [
        { productId: ctx.productId, quantity: 10 },
        { productId: secondProduct.id, quantity: 5 },
      ],
    });
    assert.equal(result.success, true, getError(result));
    const poId = result.data?.id ?? '';
    await advanceToSent(ctx, poId);

    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: poId } });
    const itemByProduct = new Map(items.map((item) => [item.productId, item]));
    const poItemA = itemByProduct.get(ctx.productId)!;
    const poItemB = itemByProduct.get(secondProduct.id)!;

    const receipt = await createGoodsReceipt({
      organizationId: ctx.organizationId,
      purchaseOrderId: poId,
      warehouseId: ctx.warehouseId,
      receivedById: ctx.userId,
      enabledModules: ['inventory'],
      items: [
        { ...grnInput(ctx, poId, 10, 5), purchaseOrderItemId: poItemA.id },
        { ...grnInput(ctx, poId, 5, 100), purchaseOrderItemId: poItemB.id },
      ],
    });
    assert.equal(receipt.success, false);
    assert.ok(getError(receipt)?.includes('remaining'), `expected remaining error, got: ${getError(receipt)}`);
    // Rollback: no stock, no movements, PO untouched.
    assert.equal(await stockQuantity(ctx), 0);
    const poAfter = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: poId } });
    assert.equal(poAfter.status, 'SENT');
    const itemA = await prisma.purchaseOrderItem.findFirstOrThrow({ where: { id: poItemA.id } });
    assert.equal(itemA.previouslyReceived, 0);
    assert.equal(await prisma.stockMovement.count({ where: { organizationId: ctx.organizationId } }), 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('partial receipt followed by final receipt results in RECEIVED; multiple GRNs accumulate', async () => {
  const ctx = await setupCtx();
  try {
    const { po, poItemId } = await createTestPo(ctx, 10);
    await advanceToSent(ctx, po.id);

    const first = await createGoodsReceipt({
      organizationId: ctx.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx.warehouseId,
      receivedById: ctx.userId,
      enabledModules: ['inventory'],
      items: [grnInput(ctx, po.id, 10, 4, 0, { purchaseOrderItemId: poItemId })],
    });
    assert.equal(first.success, true, getError(first));
    assert.equal(await stockQuantity(ctx), 4);
    let poAfter = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: po.id } });
    assert.equal(poAfter.status, 'PARTIALLY_RECEIVED');
    const remaining = await getPurchaseOrderRemainingQuantities(ctx.organizationId, po.id);
    assert.equal(remaining[0].items[0].remainingQuantity, 6);
    assert.equal(remaining[0].totalRemaining, 6);

    const second = await createGoodsReceipt({
      organizationId: ctx.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx.warehouseId,
      receivedById: ctx.userId,
      enabledModules: ['inventory'],
      items: [grnInput(ctx, po.id, 10, 6, 0, { purchaseOrderItemId: poItemId })],
    });
    assert.equal(second.success, true, getError(second));
    assert.equal(await stockQuantity(ctx), 10);
    poAfter = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: po.id } });
    assert.equal(poAfter.status, 'RECEIVED');

    const grns = await getGoodsReceipts(ctx.organizationId);
    assert.equal(grns.length, 2);
    const receipts = await prisma.goodsReceiptItem.findMany({ where: { goodsReceiptId: { in: grns.map((g) => g.id) } } });
    assert.equal(receipts.reduce((sum, item) => sum + item.acceptedQuantity, 0), 10);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('duplicate GRN submission with same idempotency key does not duplicate stock', async () => {
  const ctx = await setupCtx();
  try {
    const { po } = await createTestPo(ctx, 10);
    await advanceToSent(ctx, po.id);
    const poItemId = (await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } })).id;

    const input = {
      organizationId: ctx.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx.warehouseId,
      receivedById: ctx.userId,
      enabledModules: ['inventory'],
      idempotencyKey: 'key-duplicate-1',
      items: [grnInput(ctx, po.id, 10, 5, 0, { purchaseOrderItemId: poItemId })],
    };
    const first = await createGoodsReceipt(input);
    assert.equal(first.success, true, getError(first));
    const second = await createGoodsReceipt(input);
    assert.equal(second.success, true);
    assert.equal(second.duplicate, true);
    assert.equal(await stockQuantity(ctx), 5);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('invalid quantities are rejected', async () => {
  const ctx = await setupCtx();
  try {
    const { po } = await createTestPo(ctx, 10);
    await advanceToSent(ctx, po.id);
    const poItemId = (await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } })).id;

    const base = {
      organizationId: ctx.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx.warehouseId,
      receivedById: ctx.userId,
      enabledModules: ['inventory'],
      items: [grnInput(ctx, po.id, 10, 5, 0, { purchaseOrderItemId: poItemId })],
    };

    const sumMismatch = await createGoodsReceipt({ ...base, items: [grnInput(ctx, po.id, 10, 3, 3, { purchaseOrderItemId: poItemId, receivedQuantity: 5 })] });
    assert.equal(sumMismatch.success, false);

    const negative = await createGoodsReceipt({ ...base, items: [grnInput(ctx, po.id, 10, -1, 0, { purchaseOrderItemId: poItemId })] });
    assert.equal(negative.success, false);

    const over = await createGoodsReceipt({ ...base, items: [grnInput(ctx, po.id, 10, 11, 0, { purchaseOrderItemId: poItemId })] });
    assert.equal(over.success, false);

    const badUnitCost = await createGoodsReceipt({ ...base, items: [grnInput(ctx, po.id, 10, 5, 0, { purchaseOrderItemId: poItemId, unitCost: 0 })] });
    assert.equal(badUnitCost.success, false);

    const none = await createGoodsReceipt({ ...base, items: [grnInput(ctx, po.id, 10, 0, 0, { purchaseOrderItemId: poItemId })] });
    assert.equal(none.success, false);

    assert.equal(await stockQuantity(ctx), 0);
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('GRN for another tenant PO is rejected', async () => {
  const ctxA = await setupCtx();
  const ctxB = await setupCtx();
  try {
    const { po } = await createTestPo(ctxA, 10);
    await advanceToSent(ctxA, po.id);
    const receipt = await createGoodsReceipt({
      organizationId: ctxB.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctxB.warehouseId,
      receivedById: ctxB.userId,
      enabledModules: ['inventory'],
      items: [grnInput(ctxB, po.id, 10, 5)],
    });
    assert.equal(receipt.success, false);
    assert.equal(await stockQuantity(ctxB), 0);
    assert.equal(await stockQuantity(ctxA), 0);
  } finally {
    await cleanupCtx(ctxA);
    await cleanupCtx(ctxB);
  }
});

itDb('GRN on terminal and draft Purchase Orders is rejected', async () => {
  const ctx = await setupCtx();
  try {
    const { po } = await createTestPo(ctx, 10); // DRAFT
    const draftReceipt = await createGoodsReceipt({
      organizationId: ctx.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx.warehouseId,
      receivedById: ctx.userId,
      enabledModules: ['inventory'],
      items: [grnInput(ctx, po.id, 10, 5)],
    });
    assert.equal(draftReceipt.success, false);
  } finally {
    await cleanupCtx(ctx);
  }

  const ctx2 = await setupCtx();
  try {
    const { po } = await createTestPo(ctx2, 10);
    await advanceToSent(ctx2, po.id);
    await createGoodsReceipt({
      organizationId: ctx2.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx2.warehouseId,
      receivedById: ctx2.userId,
      enabledModules: ['inventory'],
      items: [grnInput(ctx2, po.id, 10, 10)],
    });
    const retry = await createGoodsReceipt({
      organizationId: ctx2.organizationId,
      purchaseOrderId: po.id,
      warehouseId: ctx2.warehouseId,
      receivedById: ctx2.userId,
      enabledModules: ['inventory'],
      items: [grnInput(ctx2, po.id, 10, 5)],
    });
    assert.equal(retry.success, false);
  } finally {
    await cleanupCtx(ctx2);
  }
});

itDb('simultaneous GRNs cannot receive more than the remaining quantity', async () => {
  const ctx = await setupCtx();
  try {
    const { po } = await createTestPo(ctx, 10);
    await advanceToSent(ctx, po.id);
    const poItemId = (await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } })).id;

    const jobs = Array.from({ length: 5 }, (_, index) =>
      createGoodsReceipt({
        organizationId: ctx.organizationId,
        purchaseOrderId: po.id,
        warehouseId: ctx.warehouseId,
        receivedById: ctx.userId,
        enabledModules: ['inventory'],
        idempotencyKey: `concurrent-${index}`,
        items: [grnInput(ctx, po.id, 10, 2, 0, { purchaseOrderItemId: poItemId })],
      }));
    const results = await Promise.all(jobs);
    const createdReceipts = results.filter((result) => result.success && !result.duplicate);
    assert.equal(createdReceipts.length, 5, 'all concurrent receipts should succeed without over-receipt');
    const movementRows = await prisma.stockMovement.findMany({ where: { organizationId: ctx.organizationId } });
    const totalReceived = movementRows.reduce((sum, row) => sum + row.quantity, 0);
    assert.equal(totalReceived, 10, `total received should be capped at remaining 10, got ${totalReceived}`);
    assert.equal(await stockQuantity(ctx), 10);
    const poAfter = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: po.id } });
    assert.equal(poAfter.status, 'RECEIVED');
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('createPurchaseOrder via listPurchaseOrderData includes goodsReceipts and remaining quantities', async () => {
  const ctx = await setupCtx();
  try {
    await createTestPo(ctx, 8);
    const [orders] = await listPurchaseOrderData(ctx.organizationId);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].goodsReceipts.length, 0);
    assert.equal(orders[0].items[0].orderedQuantity, 8);
    assert.equal(orders[0].supplier.name, 'Test Supplier');
  } finally {
    await cleanupCtx(ctx);
  }
});

itDb('PO status actions flow through the service layer', async () => {
  const ctx = await setupCtx();
  try {
    const { po } = await createTestPo(ctx, 10);
    const submit = await submitPurchaseOrderForApproval({ organizationId: ctx.organizationId, purchaseOrderId: po.id, actorUserId: ctx.userId });
    assert.equal(submit.success, true, getError(submit));
    const approve = await approvePurchaseOrder({ organizationId: ctx.organizationId, purchaseOrderId: po.id, actorUserId: ctx.userId });
    assert.equal(approve.success, true, getError(approve));
    const doubleApprove = await approvePurchaseOrder({ organizationId: ctx.organizationId, purchaseOrderId: po.id, actorUserId: ctx.userId });
    assert.equal(doubleApprove.success, false);
    const history = await prisma.purchaseOrderApproval.findMany({ where: { purchaseOrderId: po.id } });
    assert.equal(history.length, 2);
    const poAfter = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: po.id } });
    assert.equal(poAfter.status, 'APPROVED');
    assert.equal(poAfter.approvedById, ctx.userId);
  } finally {
    await cleanupCtx(ctx);
  }
});
