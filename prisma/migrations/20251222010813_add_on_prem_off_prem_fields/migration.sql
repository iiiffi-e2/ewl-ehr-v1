/*
  Warnings:

  - Made the column `createdAt` on table `Company` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updatedAt` on table `Company` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdAt` on table `Credential` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updatedAt` on table `Credential` required. This step will fail if there are existing NULL values in that column.
  - Made the column `receivedAt` on table `EventLog` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdAt` on table `Resident` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updatedAt` on table `Resident` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Credential" DROP CONSTRAINT "Credential_companyId_fkey";

-- DropForeignKey
ALTER TABLE "EventLog" DROP CONSTRAINT "EventLog_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Resident" DROP CONSTRAINT "Resident_companyId_fkey";

-- AlterTable
ALTER TABLE "Company" ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Credential" ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EventLog" ALTER COLUMN "receivedAt" SET NOT NULL,
ALTER COLUMN "receivedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "processedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Resident" ADD COLUMN     "offPrem" BOOLEAN,
ADD COLUMN     "offPremDate" TIMESTAMP(3),
ADD COLUMN     "onPrem" BOOLEAN,
ADD COLUMN     "onPremDate" TIMESTAMP(3),
ALTER COLUMN "dateOfBirth" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAtUtc" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
