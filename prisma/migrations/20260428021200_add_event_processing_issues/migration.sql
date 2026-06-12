-- Store durable, queryable processing issues for webhook events.
CREATE TABLE "EventProcessingIssue" (
  "id" SERIAL NOT NULL,
  "eventLogId" INTEGER,
  "companyId" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventMessageId" TEXT NOT NULL,
  "residentId" INTEGER,
  "communityId" INTEGER,
  "stage" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "details" JSONB,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EventProcessingIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventProcessingIssue_companyId_createdAt_idx"
ON "EventProcessingIssue"("companyId", "createdAt");

CREATE INDEX "EventProcessingIssue_eventLogId_idx"
ON "EventProcessingIssue"("eventLogId");

CREATE INDEX "EventProcessingIssue_eventMessageId_idx"
ON "EventProcessingIssue"("eventMessageId");

CREATE INDEX "EventProcessingIssue_stage_idx"
ON "EventProcessingIssue"("stage");

CREATE INDEX "EventProcessingIssue_severity_idx"
ON "EventProcessingIssue"("severity");

CREATE INDEX "EventProcessingIssue_resolvedAt_idx"
ON "EventProcessingIssue"("resolvedAt");

ALTER TABLE "EventProcessingIssue"
ADD CONSTRAINT "EventProcessingIssue_eventLogId_fkey"
FOREIGN KEY ("eventLogId") REFERENCES "EventLog"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventProcessingIssue"
ADD CONSTRAINT "EventProcessingIssue_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
