import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function checkColumnsExist() {
  try {
    // Check if the columns exist in the Resident table
    const result = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Resident' 
      AND column_name IN ('onPrem', 'onPremDate', 'offPrem', 'offPremDate')
      ORDER BY column_name;
    `;

    return result.map((r) => r.column_name);
  } catch (error) {
    console.error('Error checking columns:', error);
    throw error;
  }
}

async function checkMigrationStatus() {
  try {
    const result = await prisma.$queryRaw<Array<{
      migration_name: string;
      finished_at: Date | null;
    }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE migration_name = '20251222010813_add_on_prem_off_prem_fields'
      ORDER BY started_at DESC
      LIMIT 1;
    `;

    return result[0] || null;
  } catch (error) {
    console.error('Error checking migration status:', error);
    throw error;
  }
}

async function applyColumnsManually() {
  try {
    console.log('Applying columns manually...');
    await prisma.$executeRaw`
      ALTER TABLE "Resident" 
      ADD COLUMN IF NOT EXISTS "onPrem" BOOLEAN,
      ADD COLUMN IF NOT EXISTS "onPremDate" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "offPrem" BOOLEAN,
      ADD COLUMN IF NOT EXISTS "offPremDate" TIMESTAMP WITH TIME ZONE;
    `;
    console.log('✓ Columns applied successfully');
  } catch (error) {
    console.error('Error applying columns:', error);
    throw error;
  }
}

async function markMigrationAsRolledBack() {
  try {
    console.log('Marking migration as rolled back...');
    await prisma.$executeRaw`
      UPDATE "_prisma_migrations"
      SET rolled_back_at = NOW()
      WHERE migration_name = '20251222010813_add_on_prem_off_prem_fields'
      AND finished_at IS NULL;
    `;
    console.log('✓ Migration marked as rolled back');
  } catch (error) {
    console.error('Error marking migration as rolled back:', error);
    throw error;
  }
}

async function markMigrationAsApplied() {
  try {
    console.log('Marking migration as applied...');
    
    // First, try to update existing record
    const updateResult = await prisma.$executeRaw`
      UPDATE "_prisma_migrations"
      SET finished_at = NOW(),
          rolled_back_at = NULL
      WHERE migration_name = '20251222010813_add_on_prem_off_prem_fields';
    `;
    
    // If no record was updated, insert a new one
    if (updateResult === 0) {
      await prisma.$executeRaw`
        INSERT INTO "_prisma_migrations" (migration_name, started_at, finished_at)
        VALUES ('20251222010813_add_on_prem_off_prem_fields', NOW(), NOW());
      `;
      console.log('✓ Migration record inserted and marked as applied');
    } else {
      console.log('✓ Migration marked as applied');
    }
  } catch (error) {
    console.error('Error marking migration as applied:', error);
    throw error;
  }
}

async function main() {
  console.log('🔍 Checking migration status...\n');

  try {
    // Check current migration status
    const migrationStatus = await checkMigrationStatus();
    console.log('Migration status:', migrationStatus || 'Not found in _prisma_migrations table\n');

    // Check if columns exist
    const existingColumns = await checkColumnsExist();
    console.log('Existing columns:', existingColumns.length > 0 ? existingColumns : 'None found\n');

    if (existingColumns.length === 4) {
      console.log('✅ All columns already exist in the database');
      console.log('📝 Marking migration as applied...\n');
      
      await markMigrationAsApplied();
      
      console.log('\n✅ Migration state resolved! You can now run migrations again.');
    } else if (existingColumns.length > 0 && existingColumns.length < 4) {
      console.log('⚠️  Some columns exist but not all. This is unusual.');
      console.log('📝 Applying missing columns and marking migration as applied...\n');
      
      await applyColumnsManually();
      await markMigrationAsApplied();
      
      console.log('\n✅ Migration state resolved!');
    } else {
      console.log('❌ Columns do not exist');
      console.log('📝 Applying columns and marking migration as applied...\n');
      
      await applyColumnsManually();
      await markMigrationAsApplied();
      
      console.log('\n✅ Migration state resolved!');
    }

    // Verify final state
    console.log('\n🔍 Verifying final state...');
    const finalColumns = await checkColumnsExist();
    const finalStatus = await checkMigrationStatus();
    
    console.log('Final columns:', finalColumns);
    console.log('Final migration status:', finalStatus);
    
  } catch (error) {
    console.error('\n❌ Error resolving migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


