-- Add source metadata and source-scoped external identifiers for multi-EHR support.
ALTER TABLE "Resident"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'alis',
ADD COLUMN "externalResidentId" TEXT;

UPDATE "Resident"
SET "externalResidentId" = COALESCE("externalResidentId", "alisResidentId"::text);

ALTER TABLE "Resident"
ALTER COLUMN "externalResidentId" SET NOT NULL,
ALTER COLUMN "alisResidentId" DROP NOT NULL;

CREATE INDEX "Resident_companyId_source_idx" ON "Resident"("companyId", "source");
CREATE UNIQUE INDEX "Resident_companyId_source_externalResidentId_key"
  ON "Resident"("companyId", "source", "externalResidentId");

ALTER TABLE "EventLog"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'alis';

DROP INDEX "EventLog_companyId_eventType_eventMessageId_key";
DROP INDEX "EventLog_companyId_eventType_idx";

CREATE UNIQUE INDEX "EventLog_companyId_source_eventType_eventMessageId_key"
  ON "EventLog"("companyId", "source", "eventType", "eventMessageId");
CREATE INDEX "EventLog_companyId_source_eventType_idx"
  ON "EventLog"("companyId", "source", "eventType");
