#!/usr/bin/env node

/**
 * Add POS Transaction Type to Railway Database
 * Direct script to add POS transaction type to Railway database
 */

require('dotenv').config();
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');
const { QueryTypes } = require('sequelize');

async function addPOSTransactionTypeToRailway() {
  const railwayDbUrl = process.argv[2];
  
  if (!railwayDbUrl) {
    console.error('❌ Please provide Railway database URL as argument');
    console.error('Usage: node scripts/add-pos-transaction-type-railway.js <RAILWAY_DATABASE_URL>');
    process.exit(1);
  }

  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);
  const railwaySequelize = createRailwaySequelize(railwayUrl);
  const transaction = await railwaySequelize.transaction();

  try {
    console.log('\n🔄 Adding POS transaction type to Railway...');
    console.log('='.repeat(80));

    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    // Check if POS transaction type already exists
    const existingType = await railwaySequelize.query(`
      SELECT id FROM transaction_types 
      WHERE code = 'POS_TRANSACTION' OR name = 'POS Transaction'
      LIMIT 1;
    `, { transaction, type: QueryTypes.SELECT });

    const typeExists = Array.isArray(existingType) && existingType.length > 0;

    if (typeExists) {
      console.log('ℹ️  POS transaction type already exists in Railway, skipping');
      await transaction.commit();
      return;
    }

    // Insert POS transaction type (global - companyId is null)
    await railwaySequelize.query(`
      INSERT INTO transaction_types (id, code, name, description, "companyId", created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'POS_TRANSACTION',
        'POS Transaction',
        'Point of Sale (POS) transactions from retail stores',
        NULL,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      );
    `, { transaction });

    await transaction.commit();
    console.log('✅ Successfully added POS transaction type to Railway');
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error adding POS transaction type to Railway:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

addPOSTransactionTypeToRailway().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

