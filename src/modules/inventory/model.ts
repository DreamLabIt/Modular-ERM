import { prisma } from '@/core/db/prisma';
import type { CreateProductInput } from '@/core/types';
import { recordOpeningStock, adjustStockPosting } from './service';

export async function createProduct(input: CreateProductInput) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        organizationId: input.organizationId,
        sku: input.sku,
        name: input.name,
        unit: input.unit,
        costPrice: input.costPrice,
        sellingPrice: input.sellingPrice,
      },
    });

    let warehouse = await tx.warehouse.findFirst({
      where: { organizationId: input.organizationId },
    });
    if (!warehouse) {
      warehouse = await tx.warehouse.create({
        data: { organizationId: input.organizationId, name: 'Main Warehouse' },
      });
    }

    const stock = await tx.stockItem.create({
      data: { organizationId: input.organizationId, productId: product.id, warehouseId: warehouse.id, quantity: input.initialStock },
    });
    await recordOpeningStock(tx, {
      organizationId: input.organizationId,
      productId: product.id,
      warehouseId: warehouse.id,
      quantity: stock.quantity,
      createdById: null,
    });
  });
}

export async function adjustStock(input: {
  organizationId: string;
  productId: string;
  warehouseId?: string;
  adjustmentType: 'INCREASE' | 'DECREASE' | 'DAMAGED' | 'LOST' | 'EXPIRED' | 'COUNT_CORRECTION';
  quantity: number;
  reason: string;
  actorUserId?: string;
  referenceNumber?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const warehouse = input.warehouseId
    ? await prisma.warehouse.findFirst({ where: { id: input.warehouseId, organizationId: input.organizationId } })
    : await prisma.warehouse.findFirst({
        where: { stocks: { some: { productId: input.productId } }, organizationId: input.organizationId },
      });
  if (!warehouse) {
    return { success: false, error: 'Warehouse not found or not part of this organization.' };
  }
  const result = await adjustStockPosting({
    organizationId: input.organizationId,
    productId: input.productId,
    warehouseId: warehouse.id,
    quantity: input.quantity,
    adjustmentType: input.adjustmentType,
    reason: input.reason,
    referenceType: 'STOCK_ADJUSTMENT',
    referenceId: `ADJ-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    referenceNumber: input.referenceNumber,
    createdById: input.actorUserId ?? '',
    notes: input.notes,
  });
  return { success: result.success, error: result.success ? undefined : result.error };
}

export async function listProducts(organizationId: string) {
  return prisma.product.findMany({
    where: { organizationId },
    include: { stocks: { include: { warehouse: true } } },
    orderBy: { createdAt: 'desc' },
  });
}
