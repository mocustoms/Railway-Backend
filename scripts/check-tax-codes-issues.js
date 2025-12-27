#!/usr/bin/env node

/**
 * Check tax_codes table for issues preventing primary key creation
 */

require('dotenv').config();
const railwayDbConfig = require('../config/railway-db');

const railwaySequelize = railwayDbConfig.createRailwaySequelize();

async function main() {
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');
    
    // Check for NULL values
    const [nullCheck] = await railwaySequelize.query(`
      SELECT COUNT(*) as null_count
      FROM tax_codes
      WHERE id IS NULL;
    `, { type: railwaySequelize.QueryTypes.SELECT });
    
    console.log(`NULL id values: ${nullCheck.null_count}`);
    
    // Check for duplicate IDs
    const [duplicates] = await railwaySequelize.query(`
      SELECT id, COUNT(*) as count
      FROM tax_codes
      GROUP BY id
      HAVING COUNT(*) > 1;
    `, { type: railwaySequelize.QueryTypes.SELECT });
    
    console.log(`Duplicate IDs: ${duplicates.length}`);
    if (duplicates.length > 0) {
      console.log('Duplicate IDs:', duplicates);
    }
    
    // Check total count
    const [total] = await railwaySequelize.query(`
      SELECT COUNT(*) as total
      FROM tax_codes;
    `, { type: railwaySequelize.QueryTypes.SELECT });
    
    console.log(`Total records: ${total.total}`);
    
    // Check if id column is nullable
    const [columnInfo] = await railwaySequelize.query(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'tax_codes'
      AND column_name = 'id';
    `, { type: railwaySequelize.QueryTypes.SELECT });
    
    console.log(`\nColumn info:`, columnInfo);
    
    // Check existing constraints
    const [constraints] = await railwaySequelize.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
      AND table_name = 'tax_codes';
    `, { type: railwaySequelize.QueryTypes.SELECT });
    
    console.log(`\nExisting constraints:`, constraints);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await railwaySequelize.close();
  }
}

main();

