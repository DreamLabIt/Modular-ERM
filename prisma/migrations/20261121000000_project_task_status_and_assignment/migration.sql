DO $$
BEGIN
  CREATE TYPE "ProjectTaskStatus" AS ENUM (
    'TODO',
    'IN_PROGRESS',
    'REVIEW',
    'COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
DECLARE
  invalid_statuses TEXT;
BEGIN
  SELECT string_agg(DISTINCT "status"::text, ', ')
  INTO invalid_statuses
  FROM "ProjectTask"
  WHERE "status"::text NOT IN (
    'TODO',
    'IN_PROGRESS',
    'REVIEW',
    'COMPLETED',
    'DONE'
  );

  IF invalid_statuses IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot migrate ProjectTask.status; unsupported values found: %',
      invalid_statuses;
  END IF;
END $$;

UPDATE "ProjectTask"
SET "status" = 'COMPLETED'
WHERE "status"::text = 'DONE';

ALTER TABLE "ProjectTask"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "ProjectTask"
  ALTER COLUMN "status" TYPE "ProjectTaskStatus"
  USING "status"::text::"ProjectTaskStatus";

ALTER TABLE "ProjectTask"
  ALTER COLUMN "status" SET DEFAULT 'TODO'::"ProjectTaskStatus";

ALTER TABLE "ProjectTask"
  ADD COLUMN IF NOT EXISTS "assigneeEmployeeId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ProjectTask_assigneeEmployeeId_fkey'
      AND conrelid = '"ProjectTask"'::regclass
  ) THEN
    ALTER TABLE "ProjectTask"
      ADD CONSTRAINT "ProjectTask_assigneeEmployeeId_fkey"
      FOREIGN KEY ("assigneeEmployeeId")
      REFERENCES "Employee"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ProjectTask_assigneeEmployeeId_idx"
  ON "ProjectTask"("assigneeEmployeeId");
