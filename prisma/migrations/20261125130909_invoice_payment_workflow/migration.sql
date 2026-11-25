ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "issueDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inventoryDeducted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stockRestored" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledById" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Invoice"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE INDEX IF NOT EXISTS "Invoice_organizationId_status_idx"
  ON "Invoice"("organizationId", "status");

CREATE INDEX IF NOT EXISTS "Invoice_organizationId_dueDate_idx"
  ON "Invoice"("organizationId", "dueDate");

CREATE TABLE IF NOT EXISTS "InvoicePayment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "referenceNumber" TEXT,
  "notes" TEXT,
  "receivedById" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoicePayment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoicePayment_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvoicePayment_receivedById_fkey"
    FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "InvoicePayment_positive_amount" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "InvoicePayment_organizationId_idempotencyKey_key"
  ON "InvoicePayment"("organizationId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "InvoicePayment_organizationId_invoiceId_idx"
  ON "InvoicePayment"("organizationId", "invoiceId");
CREATE INDEX IF NOT EXISTS "InvoicePayment_organizationId_paymentDate_idx"
  ON "InvoicePayment"("organizationId", "paymentDate");

CREATE TABLE IF NOT EXISTS "InvoiceStockMovement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceStockMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceStockMovement_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoiceStockMovement_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoiceStockMovement_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvoiceStockMovement_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvoiceStockMovement_positive_quantity" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceStockMovement_invoiceId_productId_warehouseId_key"
  ON "InvoiceStockMovement"("invoiceId", "productId", "warehouseId");
CREATE INDEX IF NOT EXISTS "InvoiceStockMovement_organizationId_invoiceId_idx"
  ON "InvoiceStockMovement"("organizationId", "invoiceId");

ALTER TABLE "AccountTransaction"
  ADD COLUMN IF NOT EXISTS "invoicePaymentId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AccountTransaction_invoicePaymentId_fkey'
      AND conrelid = '"AccountTransaction"'::regclass
  ) THEN
    ALTER TABLE "AccountTransaction"
      ADD CONSTRAINT "AccountTransaction_invoicePaymentId_fkey"
      FOREIGN KEY ("invoicePaymentId") REFERENCES "InvoicePayment"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AccountTransaction_invoicePaymentId_key"
  ON "AccountTransaction"("invoicePaymentId")
  WHERE "invoicePaymentId" IS NOT NULL;

-- Legacy PAID invoices are intentionally preserved. This migration does
-- not fabricate payment history or imply that legacy PAID records were paid
-- through the new InvoicePayment workflow.
