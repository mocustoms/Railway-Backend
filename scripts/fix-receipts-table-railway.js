/**
 * Script to check and fix receipts table primary key in Railway database
 * This ensures the receipts table has a proper primary key before creating foreign keys
 * 
 * Usage:
 *   - Local DB: node scripts/fix-receipts-table-railway.js
 *   - Railway DB: RAILWAY_DB_URL="postgresql://..." node scripts/fix-receipts-table-railway.js
 */

const railwayDbConfig = require('../config/railway-db');

// Use Railway DB if --railway flag is passed, otherwise use local
const useRailway = process.argv.includes('--railway');

let sequelize;
if (useRailway) {
  console.log('🔗 Connecting to Railway database...\n');
  sequelize = railwayDbConfig.createRailwaySequelize();
} else {
  // Use local database
  const { sequelize: localSequelize } = require('../server/models');
  sequelize = localSequelize;
  console.log('🔗 Connecting to local database...\n');
}

async function fixReceiptsTable() {
  console.log('🔍 Checking receipts table structure in Railway...\n');

  try {
    // Test database connection first
    console.log('Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    // Check if receipts table exists
    const [tableCheck] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'receipts'
      ) as exists;
    `, { type: sequelize.QueryTypes.SELECT });

    if (!tableCheck.exists) {
      console.log('❌ Receipts table does not exist. Please run the receipts table migration first.');
      return;
    }

    console.log('✅ Receipts table exists\n');

    // Check if receipts table has primary key
    const [primaryKeyCheck] = await sequelize.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_schema = 'public' 
      AND table_name = 'receipts' 
      AND constraint_type = 'PRIMARY KEY';
    `, { type: sequelize.QueryTypes.SELECT });

    if (!primaryKeyCheck || primaryKeyCheck.length === 0) {
      console.log('⚠️  Receipts table does not have a primary key. Attempting to add...\n');
      
      // Check if id column exists
      const [idColumnCheck] = await sequelize.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'receipts' 
        AND column_name = 'id';
      `, { type: sequelize.QueryTypes.SELECT });

      if (!idColumnCheck) {
        console.log('❌ Receipts table does not have an id column. Cannot add primary key.');
        return;
      }

      console.log(`✅ Found id column: ${idColumnCheck.data_type}, nullable: ${idColumnCheck.is_nullable}\n`);

      // Try to add primary key
      try {
        await sequelize.query(`
          ALTER TABLE "receipts" 
          ADD CONSTRAINT "receipts_pkey" 
          PRIMARY KEY ("id");
        `);
        console.log('✅ Successfully added primary key to receipts table\n');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('✅ Primary key already exists (this is fine)\n');
        } else {
          console.error('❌ Error adding primary key:', error.message);
          throw error;
        }
      }
    } else {
      console.log(`✅ Receipts table has primary key: ${primaryKeyCheck.constraint_name}\n`);
    }

    // Check if receipt_transactions table exists and has foreign keys
    const [rtTableCheck] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'receipt_transactions'
      ) as exists;
    `, { type: sequelize.QueryTypes.SELECT });

    if (rtTableCheck.exists) {
      console.log('✅ Receipt_transactions table exists\n');

      // Check for foreign key constraints
      const [fkCheck] = await sequelize.query(`
        SELECT constraint_name, table_name, column_name
        FROM information_schema.key_column_usage
        WHERE table_schema = 'public' 
        AND table_name = 'receipt_transactions'
        AND column_name IN ('receipt_id', 'reversed_receipt_id');
      `, { type: sequelize.QueryTypes.SELECT });

      if (fkCheck && fkCheck.length > 0) {
        console.log('✅ Foreign key constraints found:');
        fkCheck.forEach(fk => {
          console.log(`   - ${fk.constraint_name} on ${fk.column_name}`);
        });
      } else {
        console.log('⚠️  No foreign key constraints found. Adding them...\n');

        // Add foreign key for receipt_id
        try {
          await sequelize.query(`
            ALTER TABLE "receipt_transactions" 
            ADD CONSTRAINT "receipt_transactions_receipt_id_fkey" 
            FOREIGN KEY ("receipt_id") 
            REFERENCES "receipts" ("id") 
            ON DELETE CASCADE 
            ON UPDATE CASCADE;
          `);
          console.log('✅ Added foreign key constraint for receipt_id\n');
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log('✅ Foreign key for receipt_id already exists\n');
          } else {
            console.error('❌ Error adding receipt_id foreign key:', error.message);
          }
        }

        // Add foreign key for reversed_receipt_id
        try {
          await sequelize.query(`
            ALTER TABLE "receipt_transactions" 
            ADD CONSTRAINT "receipt_transactions_reversed_receipt_id_fkey" 
            FOREIGN KEY ("reversed_receipt_id") 
            REFERENCES "receipts" ("id") 
            ON DELETE SET NULL 
            ON UPDATE CASCADE;
          `);
          console.log('✅ Added foreign key constraint for reversed_receipt_id\n');
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log('✅ Foreign key for reversed_receipt_id already exists\n');
          } else {
            console.error('❌ Error adding reversed_receipt_id foreign key:', error.message);
          }
        }
      }
    } else {
      console.log('ℹ️  Receipt_transactions table does not exist yet. It will be created by migration.\n');
    }

    console.log('✅ Fix completed!');
    
  } catch (error) {
    console.error('❌ Error fixing receipts table:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    try {
      await sequelize.close();
      console.log('\n✅ Database connection closed');
    } catch (closeError) {
      console.error('Error closing connection:', closeError.message);
    }
    process.exit(0);
  }
}

// Run the fix
fixReceiptsTable().catch(console.error);

