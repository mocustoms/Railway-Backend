#!/usr/bin/env node

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
    console.log('✅ Connected to Railway\n');
    
    const columns = await railwaySequelize.query(`
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'physical_inventories'
      ORDER BY ordinal_position;
    `, {
      type: railwaySequelize.QueryTypes.SELECT
    });
    
    console.log('Columns in physical_inventories:');
    console.log('');
    columns.forEach(c => {
      console.log(`  ${c.column_name}: ${c.data_type} (${c.udt_name}) - ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    
    // Check for status enum
    const statusCol = columns.find(c => c.column_name === 'status');
    if (statusCol) {
      console.log('');
      console.log('Checking status enum values...');
      const enumValues = await railwaySequelize.query(`
        SELECT e.enumlabel as value
        FROM pg_type t 
        JOIN pg_enum e ON t.oid = e.enumtypid  
        WHERE t.typname = :enumName
        ORDER BY e.enumsortorder;
      `, {
        replacements: { enumName: statusCol.udt_name },
        type: railwaySequelize.QueryTypes.SELECT
      });
      
      if (enumValues && enumValues.length > 0) {
        console.log(`\nStatus enum values (${enumValues.length}):`);
        enumValues.forEach(e => console.log(`  - ${e.value}`));
        
        const required = ['draft', 'submitted', 'approved', 'rejected', 'returned_for_correction'];
        const missing = required.filter(v => !enumValues.some(e => e.value === v));
        
        if (missing.length > 0) {
          console.log('\n❌ MISSING VALUES:');
          missing.forEach(v => console.log(`   - ${v}`));
        } else {
          console.log('\n✅ All required values present');
        }
      }
    }
    
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

