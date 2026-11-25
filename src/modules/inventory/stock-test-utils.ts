import assert from 'node:assert/strict';
import { prisma } from '@/core/db/prisma';

export interface TestCtx {
  organizationId: string;
  userId: string;
  supplierId: string;
  productId: string;
  warehouseId: string;
  secondWarehouseId: string;
}

export async function isDbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function setupCtx(prefix = 'inv-stock-test'): Promise<TestCtx> {
  const organization = await prisma.organization.create({
    data: { name: `${prefix} ${Date.now()}`, slug: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
  });
  const role = await prisma.role.create({
    data: { organizationId: organization.id, name: 'Admin', permissions: ['*'] },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      roleId: role.id,
      name: 'Inventory Test Admin',
      email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@local.test`,
      passwordHash: 'not-a-real-hash',
    },
  });
  const supplier = await prisma.supplier.create({ data: { organizationId: organization.id, name: 'Test Supplier' } });
  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      sku: `TEST-${Date.now()}`,
      name: 'Test Product',
      costPrice: 10,
      sellingPrice: 25,
    },
  });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: organization.id, name: 'Main Warehouse' } });
  const secondWarehouse = await prisma.warehouse.create({ data: { organizationId: organization.id, name: 'Secondary Warehouse' } });
  await prisma.stockItem.create({ data: { organizationId: organization.id, productId: product.id, warehouseId: warehouse.id, quantity: 0 } });
  await prisma.stockItem.create({ data: { organizationId: organization.id, productId: product.id, warehouseId: secondWarehouse.id, quantity: 0 } });
  return {
    organizationId: organization.id,
    userId: user.id,
    supplierId: supplier.id,
    productId: product.id,
    warehouseId: warehouse.id,
    secondWarehouseId: secondWarehouse.id,
  };
}

export async function cleanupCtx(ctx: TestCtx) {
  const org = ctx.organizationId;
  await prisma.securityAuditLog.deleteMany({ where: { organizationId: org } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: org } });
  await prisma.stockReservation.deleteMany({ where: { organizationId: org } });
  await prisma.stockAdjustment.deleteMany({ where: { organizationId: org } });
  await prisma.invoiceStockMovement.deleteMany({ where: { organizationId: org } });
  await prisma.invoiceItem.deleteMany({ where: { invoice: { organizationId: org } } });
  await prisma.invoice.deleteMany({ where: { organizationId: org } });
  await prisma.goodsReceipt.deleteMany({ where: { organizationId: org } });
  await prisma.purchaseOrder.deleteMany({ where: { organizationId: org } });
  await prisma.supplier.deleteMany({ where: { organizationId: org } });
  await prisma.stockItem.deleteMany({ where: { product: { organizationId: org } } });
  await prisma.warehouse.deleteMany({ where: { organizationId: org } });
  await prisma.product.deleteMany({ where: { organizationId: org } });
  await prisma.user.deleteMany({ where: { organizationId: org } });
  await prisma.role.deleteMany({ where: { organizationId: org } });
  await prisma.organization.deleteMany({ where: { id: org } });
}

export async function physicalStock(ctx: TestCtx, warehouseId = ctx.warehouseId): Promise<number> {
  const stock = await prisma.stockItem.findFirst({ where: { productId: ctx.productId, warehouseId } });
  return stock ? stock.quantity : 0;
}

export async function assertLedgerBalances(ctx: TestCtx) {
  const movements = await prisma.stockMovement.findMany({ where: { organizationId: ctx.organizationId } });
  const ledgerByKey = new Map<string, number>();
  for (const movement of movements) {
    const key = `${movement.productId}:${movement.warehouseId}`;
    ledgerByKey.set(key, (ledgerByKey.get(key) ?? 0) + movement.quantity);
  }
  const stocks = await prisma.stockItem.findMany({ where: { product: { organizationId: ctx.organizationId } } });
  for (const stock of stocks) {
    const key = `${stock.productId}:${stock.warehouseId}`;
    assert.equal(
      stock.quantity,
      ledgerByKey.get(key) ?? 0,
      `Ledger balance and stock balance must match for ${key}`,
    );
  }
}
