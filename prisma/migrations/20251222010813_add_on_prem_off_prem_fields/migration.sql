-- AlterTable: Add On_Prem and Off_Prem columns to Resident table
ALTER TABLE "Resident" 
ADD COLUMN "onPrem" BOOLEAN,
ADD COLUMN "onPremDate" TIMESTAMP WITH TIME ZONE,
ADD COLUMN "offPrem" BOOLEAN,
ADD COLUMN "offPremDate" TIMESTAMP WITH TIME ZONE;
