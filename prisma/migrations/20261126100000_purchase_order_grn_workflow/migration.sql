-- Purchase Order & Goods Received Note workflow migration.
--
-- 1. PurchaseOrder: add workflow columns. warehouseId is added nullable and
--    backfilled from the organization's first warehouse; legacy RECEIVED
--    records are marked with legacyReceivedAt and are NOT given receipt
--    history or stock movements (they stay terminal and data is preserved).
-- 2. PurchaseOrderItem: rename legacy `quantity` to `orderedQuantity`
--    (data is preserved). Add `previouslyReceived` to track accepted
--    quantities from earlier GRNs.
-- 3. Create GoodsReceipt, GoodsReceiptItem, StockMovement and
--    PurchaseOrderApproval tables.
-- 4. Backfill warehouseId and apply the NOT NULL constraint.

-- AlterTable
ALTER TABLE "PurchaseOrder"
  ADD COLUMN IF NOT EXISTS "warehouseId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expectedDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "legacyReceivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receivedDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PurchaseOrder" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Backfill warehouseId for legacy PurchaseOrders from the first warehouse of
-- the organization. Safe for orgs without warehouses: they keep NULL and the
-- constraint below fails loudly, which is preferable to silently guessing.
UPDATE "PurchaseOrder" po
SET "warehouseId" = w.id
FROM "Warehouse" w
WHERE po."warehouseId" IS NULL
  AND w."organizationId" = po."organizationId"
  AND w.id = (
    SELECT w2.id
    FROM "Warehouse" w2
    WHERE w2."organizationId" = po."organizationId"
    ORDER BY w2.id
    LIMIT 1
  );

ALTER TABLE "PurchaseOrder" ALTER COLUMN "warehouseId" SET NOT NULL;

-- AlterTable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PurchaseOrderItem' AND column_name = 'quantity'
  ) THEN
    ALTER TABLE "PurchaseOrderItem" RENAME COLUMN "quantity" TO "orderedQuantity";
  END IF;
END $$;

ALTER TABLE "PurchaseOrderItem"
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "previouslyReceived" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PurchaseOrderApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "approvedById" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "notes" TEXT,
    "receivedById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GoodsReceiptItem" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderedQuantity" INTEGER NOT NULL,
    "previouslyReceived" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL,
    "acceptedQuantity" INTEGER NOT NULL,
    "rejectedQuantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "goodsReceiptId" TEXT,
    "purchaseOrderId" TEXT,
    "unitCost" DECIMAL(12,2),
    "movementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PurchaseOrderApproval_purchaseOrderId_createdAt_idx" ON "PurchaseOrderApproval"("purchaseOrderId", "createdAt");

CREATE INDEX IF NOT EXISTS "GoodsReceipt_organizationId_receivedDate_idx" ON "GoodsReceipt"("organizationId", "receivedDate");

CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceipt_organizationId_receiptNumber_key" ON "GoodsReceipt"("organizationId", "receiptNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceipt_organizationId_idempotencyKey_key" ON "GoodsReceipt"("organizationId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "GoodsReceiptItem_productId_idx" ON "GoodsReceiptItem"("productId");

CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceiptItem_goodsReceiptId_purchaseOrderItemId_key" ON "GoodsReceiptItem"("goodsReceiptId", "purchaseOrderItemId");

CREATE INDEX IF NOT EXISTS "StockMovement_organizationId_productId_warehouseId_idx" ON "StockMovement"("organizationId", "productId", "warehouseId");

CREATE INDEX IF NOT EXISTS "StockMovement_organizationId_referenceType_referenceId_idx" ON "StockMovement"("organizationId", "referenceType", "referenceId");

CREATE UNIQUE INDEX IF NOT EXISTS "StockMovement_goodsReceiptId_productId_warehouseId_key" ON "StockMovement"("goodsReceiptId", "productId", "warehouseId");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_organizationId_status_idx" ON "PurchaseOrder"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderApproval" ADD CONSTRAINT "PurchaseOrderApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderApproval" ADD CONSTRAINT "PurchaseOrderApproval_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: mark legacy RECEIVED PurchaseOrders that predate this workflow
-- and have no GoodsReceipt rows. No receipt history or stock movements are
-- fabricated for them; they remain terminal and unchanged.
UPDATE "PurchaseOrder"
SET "legacyReceivedAt" = COALESCE("updatedAt", "createdAt")
WHERE "status" = 'RECEIVED'
  AND NOT EXISTS (
    SELECT 1 FROM "GoodsReceipt" gr WHERE gr."purchaseOrderId" = "PurchaseOrder"."id"
  );
