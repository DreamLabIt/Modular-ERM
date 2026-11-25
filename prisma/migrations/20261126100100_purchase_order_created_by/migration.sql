ALTER TABLE "PurchaseOrder"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
