import { prisma } from '@/core/db/prisma';
import type { CreateProductInput } from '@/core/types';

export async function createProduct(input: CreateProductInput) {
  await prisma.$transaction(async (tx) => {
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

    await tx.stockItem.create({
      data: { productId: product.id, warehouseId: warehouse.id, quantity: input.initialStock },
    });
  });
}

export async function adjustStock(productId: string, delta: number, organizationId: string) {
  const stock = await prisma.stockItem.findFirst({
    where: { productId, product: { organizationId } },
  });
  if (stock) {
    await prisma.stockItem.update({
      where: { id: stock.id },
      data: { quantity: Math.max(0, stock.quantity + delta) },
    });
  }
}

export async function listProducts(organizationId: string) {
  return prisma.product.findMany({
    where: { organizationId },
    include: { stocks: true },
    orderBy: { createdAt: 'desc' },
  });
}
