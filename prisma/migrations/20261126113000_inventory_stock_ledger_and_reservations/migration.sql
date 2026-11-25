-- DropIndex
DROP INDEX "StockMovement_organizationId_productId_warehouseId_idx";

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "newQuantity" INTEGER,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "previousQuantity" INTEGER,
ADD COLUMN     "referenceNumber" TEXT;

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "reservedQuantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "referenceNumber" TEXT,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previousQuantity" INTEGER,
    "newQuantity" INTEGER,
    "reason" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockReservation_organizationId_status_idx" ON "StockReservation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_productId_status_idx" ON "StockReservation"("productId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_warehouseId_status_idx" ON "StockReservation"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_organizationId_referenceType_referenceId_idx" ON "StockReservation"("organizationId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "StockAdjustment_organizationId_adjustmentType_idx" ON "StockAdjustment"("organizationId", "adjustmentType");

-- CreateIndex
CREATE INDEX "StockAdjustment_productId_warehouseId_idx" ON "StockAdjustment"("productId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_productId_warehouseId_movement_idx" ON "StockMovement"("organizationId", "productId", "warehouseId", "movementType");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_createdAt_idx" ON "StockMovement"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill OPENING_STOCK movements for existing physical stock so the ledger
-- starts from the current balances. Skips zero quantities.
INSERT INTO "StockMovement" (
  "id",
  "organizationId",
  "productId",
  "warehouseId",
  "movementType",
  "quantity",
  "referenceType",
  "referenceId",
  "previousQuantity",
  "newQuantity",
  "movementDate",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  p."organizationId",
  s."productId",
  s."warehouseId",
  'OPENING_STOCK',
  s.quantity,
  'LEGACY_STOCK',
  'StockItem:' || s."id",
  s.quantity,
  s.quantity,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "StockItem" s
JOIN "Product" p ON p.id = s."productId"
WHERE s.quantity > 0;
