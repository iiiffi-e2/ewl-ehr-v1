-- Allow same EventMessageId across different event types for a company.
ALTER TABLE "EventLog" DROP CONSTRAINT "EventLog_eventMessageId_key";

-- Prevent true duplicates while allowing move-in and room-assigned to coexist.
CREATE UNIQUE INDEX "EventLog_companyId_eventType_eventMessageId_key"
ON "EventLog"("companyId", "eventType", "eventMessageId");
