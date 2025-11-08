-- CreateTable Company
CREATE TABLE "Company" (
    "id" SERIAL PRIMARY KEY,
    "companyKey" TEXT NOT NULL UNIQUE,
    "name" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CreateTable Credential
CREATE TABLE "Credential" (
    "id" SERIAL PRIMARY KEY,
    "companyId" INTEGER NOT NULL UNIQUE,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT "Credential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable Resident
CREATE TABLE "Resident" (
    "id" SERIAL PRIMARY KEY,
    "companyId" INTEGER NOT NULL,
    "alisResidentId" INTEGER NOT NULL UNIQUE,
    "status" TEXT NOT NULL,
    "productType" TEXT,
    "classification" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP WITH TIME ZONE,
    "roomNumber" TEXT,
    "bed" TEXT,
    "room" TEXT,
    "updatedAtUtc" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT "Resident_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Resident_companyId_idx" ON "Resident" ("companyId");

-- CreateTable EventLog
CREATE TABLE "EventLog" (
    "id" SERIAL PRIMARY KEY,
    "companyId" INTEGER NOT NULL,
    "communityId" INTEGER,
    "eventType" TEXT NOT NULL,
    "eventMessageId" TEXT NOT NULL UNIQUE,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "processedAt" TIMESTAMP WITH TIME ZONE,
    "status" TEXT NOT NULL,
    "error" TEXT,
    CONSTRAINT "EventLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "EventLog_companyId_eventType_idx" ON "EventLog" ("companyId", "eventType");
