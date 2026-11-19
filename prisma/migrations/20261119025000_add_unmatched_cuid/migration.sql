CREATE TABLE "UnmatchedCuid" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "communityId" INTEGER NOT NULL,
    "externalResidentId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "syntheticCuid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventType" TEXT NOT NULL,
    "lastEventMessageId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnmatchedCuid_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnmatchedCuid_companyId_communityId_externalResidentId_roomNumber_key"
ON "UnmatchedCuid"("companyId", "communityId", "externalResidentId", "roomNumber");

CREATE INDEX "UnmatchedCuid_communityId_status_idx"
ON "UnmatchedCuid"("communityId", "status");

CREATE INDEX "UnmatchedCuid_status_lastSeenAt_idx"
ON "UnmatchedCuid"("status", "lastSeenAt");

ALTER TABLE "UnmatchedCuid"
ADD CONSTRAINT "UnmatchedCuid_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;