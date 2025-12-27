#!/usr/bin/env node

/**
 * Check Physical Inventory Status Enum
 * 
 * Verifies that Railway has the 'submitted' status in the enum
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Sequelize } = require('sequelize');

function parseDatabaseUrl(databaseUrl) {
  let normalizedUrl = databaseUrl.trim().replace(/^postgresql:\/\//, 'postgres://');
  const url = new URL(normalizedUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    username: url.username || 'postgres',
    password: url.password || ''
  };
}

async function main() {
  const railwayDbUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  
  if (!railwayDbUrl) {
    console.error('❌ Error: Railway DATABASE_URL is required');
    process.exit(1);
  }
  
  const railwayConfig = parseDatabaseUrl(railwayDbUrl);
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
  
  try {
    await railwaySequelize.authenticate();
    console.log('✅ Connected to Railway database\n');
    
    // Get enum values
    const [enumValues] = await railwaySequelize.query(`
      SELECT 
        t.typname as enum_name,
        e.enumlabel as enum_value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname LIKE '%physical%inventory%status%' OR t.typname LIKE '%status%'
      ORDER BY t.typname, e.enumsortorder;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    // Also check the column definition directly
    const [columnDef] = await railwaySequelize.query(`
      SELECT 
        column_name,
        data_type,
        udt_name,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'physical_inventories'
        AND column_name = 'status';
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('📋 Status Column Definition');
    console.log('═'.repeat(80));
    console.log('');
    if (columnDef && columnDef.length > 0) {
      console.log(`Column: ${columnDef[0].column_name}`);
      console.log(`Data Type: ${columnDef[0].data_type}`);
      console.log(`UDT Name: ${columnDef[0].udt_name}`);
      console.log(`Default: ${columnDef[0].column_default || 'NULL'}`);
    } else {
      console.log('❌ Status column not found!');
    }
    console.log('');
    
    // Get enum values for the status column
    const [statusEnum] = await railwaySequelize.query(`
      SELECT 
        e.enumlabel as value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname = (
        SELECT udt_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'physical_inventories' 
          AND column_name = 'status'
      )
      ORDER BY e.enumsortorder;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('📝 Status Enum Values');
    console.log('═'.repeat(80));
    console.log('');
    
    if (statusEnum && statusEnum.length > 0) {
      const values = statusEnum.map(e => e.value);
      console.log(`Found ${values.length} enum values:`);
      values.forEach(v => console.log(`  - ${v}`));
      console.log('');
      
      const requiredValues = ['draft', 'submitted', 'approved', 'rejected', 'returned_for_correction'];
      const missing = requiredValues.filter(v => !values.includes(v));
      
      if (missing.length > 0) {
        console.log('❌ MISSING REQUIRED VALUES:');
        missing.forEach(v => console.log(`   - ${v}`));
        console.log('');
        console.log('⚠️  This is likely the issue! Railway needs the "submitted" status.');
      } else {
        console.log('✅ All required enum values are present');
      }
    } else {
      console.log('⚠️  Could not determine enum values (might be a different data type)');
    }
    console.log('');
    
    // Check current status values in the table
    const [currentStatuses] = await railwaySequelize.query(`
      SELECT DISTINCT status, COUNT(*) as count
      FROM physical_inventories
      GROUP BY status
      ORDER BY status;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('📊 Current Status Values in Table');
    console.log('═'.repeat(80));
    console.log('');
    
    if (currentStatuses && currentStatuses.length > 0) {
      currentStatuses.forEach(s => {
        console.log(`  ${s.status}: ${s.count} records`);
      });
    } else {
      console.log('  No records found');
    }
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

main().catch(console.error);

