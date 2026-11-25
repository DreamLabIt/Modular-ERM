ALTER TABLE "Role"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "authorizationVersion" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "Role_id_organizationId_key"
  ON "Role"("id", "organizationId");

DO $$
DECLARE
  invalid_assignments INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO invalid_assignments
  FROM "User" AS u
  LEFT JOIN "Role" AS r
    ON r."id" = u."roleId"
   AND r."organizationId" = u."organizationId"
  WHERE r."id" IS NULL;

  IF invalid_assignments > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce tenant-scoped User.role relation: % cross-organization or orphaned role assignment(s) found',
      invalid_assignments;
  END IF;
END $$;

ALTER TABLE "User"
  DROP CONSTRAINT IF EXISTS "User_roleId_fkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'User_roleId_organizationId_fkey'
      AND conrelid = '"User"'::regclass
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_roleId_organizationId_fkey"
      FOREIGN KEY ("roleId", "organizationId")
      REFERENCES "Role"("id", "organizationId")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SecurityAuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecurityAuditLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SecurityAuditLog_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SecurityAuditLog_organizationId_createdAt_idx"
  ON "SecurityAuditLog"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "SecurityAuditLog_targetType_targetId_idx"
  ON "SecurityAuditLog"("targetType", "targetId");
