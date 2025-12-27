const { Sequelize, QueryTypes } = require('sequelize');
const config = require('../env');

// Parse database URL helper
function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  
  try {
    let normalizedUrl = databaseUrl.trim();
    if (!normalizedUrl.startsWith('postgres://') && !normalizedUrl.startsWith('postgresql://')) {
      throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
    }
    
    normalizedUrl = normalizedUrl.replace(/^postgresql:\/\//, 'postgres://');
    const url = new URL(normalizedUrl);
    
    const databaseName = url.pathname ? url.pathname.slice(1) : '';
    
    if (!databaseName) {
      throw new Error('Database name not found in DATABASE_URL pathname');
    }
    
    return {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: databaseName,
      username: url.username || 'postgres',
      password: url.password || ''
    };
  } catch (error) {
    throw new Error(`Failed to parse DATABASE_URL: ${error.message}`);
  }
}

async function getEnumValues(sequelize, enumName) {
  try {
    const [results] = await sequelize.query(`
      SELECT e.enumlabel as value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname = :enumName
      ORDER BY e.enumsortorder;
    `, {
      replacements: { enumName },
      type: QueryTypes.SELECT
    });
    
    return Array.isArray(results) ? results.map(r => r.value) : [];
  } catch (error) {
    console.error(`Error getting enum values for ${enumName}:`, error.message);
    return [];
  }
}

async function checkDatabase(sequelize, dbName) {
  try {
    await sequelize.authenticate();
    console.log(`\n✅ Connected to ${dbName} database\n`);
    
    // First, find the actual enum name
    const [enumTypes] = await sequelize.query(`
      SELECT t.typname as enum_name
      FROM pg_type t 
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' 
        AND t.typtype = 'e'
        AND (t.typname LIKE '%linked%account%' OR t.typname LIKE '%account_type%')
      ORDER BY t.typname;
    `, {
      type: QueryTypes.SELECT
    });
    
    console.log(`📋 Found enum types related to linked accounts:`);
    if (Array.isArray(enumTypes) && enumTypes.length > 0) {
      enumTypes.forEach(e => console.log(`     - ${e.enum_name}`));
    } else {
      console.log(`     (none found)`);
    }
    console.log('');
    
    // Try both possible enum names
    let enumValues = [];
    const possibleNames = ['enum_linked_accounts_account_type', 'enum_linked_account_type'];
    
    for (const enumName of possibleNames) {
      const values = await getEnumValues(sequelize, enumName);
      if (values.length > 0) {
        enumValues = values;
        console.log(`✅ Using enum: ${enumName}`);
        break;
      }
    }
    
    // If still empty, try to get from the table definition
    if (enumValues.length === 0) {
      const [columnInfo] = await sequelize.query(`
        SELECT udt_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' 
          AND table_name = 'linked_accounts'
          AND column_name = 'account_type';
      `, {
        type: QueryTypes.SELECT
      });
      
      if (Array.isArray(columnInfo) && columnInfo.length > 0 && columnInfo[0].udt_name) {
        const actualEnumName = columnInfo[0].udt_name;
        console.log(`📋 Found enum name from table: ${actualEnumName}`);
        enumValues = await getEnumValues(sequelize, actualEnumName);
      }
    }
    
    console.log(`📋 Enum: enum_linked_accounts_account_type`);
    console.log(`   Found ${enumValues.length} values:`);
    enumValues.forEach(v => console.log(`     - ${v}`));
    
    // Expected values from model
    const expectedValues = [
      'customer_deposits',
      'payables',
      'receivables',
      'cost_of_goods_sold',
      'inventory',
      'sales_revenue',
      'discounts_allowed',
      'discounts_received',
      'opening_balance_equity',
      'current_earnings',
      'retained_earnings',
      'sales_returns_liability',
      'account_balance',
      'loyalty_cards',
      'cash_customer',
      'withholding_tax_payable'
    ];
    
    console.log(`\n   Expected ${expectedValues.length} values (from model):`);
    expectedValues.forEach(v => console.log(`     - ${v}`));
    
    // Find missing values
    const missing = expectedValues.filter(v => !enumValues.includes(v));
    const extra = enumValues.filter(v => !expectedValues.includes(v));
    
    if (missing.length > 0) {
      console.log(`\n   ❌ MISSING VALUES (${missing.length}):`);
      missing.forEach(v => console.log(`     - ${v}`));
    } else {
      console.log(`\n   ✅ All expected values are present`);
    }
    
    if (extra.length > 0) {
      console.log(`\n   ⚠️  EXTRA VALUES (not in model) (${extra.length}):`);
      extra.forEach(v => console.log(`     - ${v}`));
    }
    
    return { enumValues, missing, extra };
  } catch (error) {
    console.error(`❌ Error checking ${dbName}:`, error.message);
    throw error;
  }
}

async function main() {
  const railwayDbUrl = process.argv[2] || 'postgres://postgres:bHgyHEtSVvBYcMPRGKvbigMiJZSPoSeo@nozomi.proxy.rlwy.net:33624/railway';
  
  console.log('═'.repeat(80));
  console.log('🔍 Checking Linked Accounts Enum Values');
  console.log('═'.repeat(80));
  
  // Check local database
  const localSequelize = require('../config/database');
  let localResult;
  try {
    localResult = await checkDatabase(localSequelize, 'LOCAL');
  } catch (error) {
    console.error('❌ Failed to check local database:', error.message);
    localResult = null;
  }
  
  // Check Railway database
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
  
  let railwayResult;
  try {
    railwayResult = await checkDatabase(railwaySequelize, 'RAILWAY');
  } catch (error) {
    console.error('❌ Failed to check Railway database:', error.message);
    railwayResult = null;
  }
  
  // Compare results
  if (localResult && railwayResult) {
    console.log('\n' + '═'.repeat(80));
    console.log('📊 COMPARISON');
    console.log('═'.repeat(80));
    
    const localValues = new Set(localResult.enumValues);
    const railwayValues = new Set(railwayResult.enumValues);
    
    const inLocalNotRailway = localResult.enumValues.filter(v => !railwayValues.has(v));
    const inRailwayNotLocal = railwayResult.enumValues.filter(v => !localValues.has(v));
    
    if (inLocalNotRailway.length > 0) {
      console.log(`\n   Values in LOCAL but NOT in RAILWAY (${inLocalNotRailway.length}):`);
      inLocalNotRailway.forEach(v => console.log(`     - ${v}`));
    }
    
    if (inRailwayNotLocal.length > 0) {
      console.log(`\n   Values in RAILWAY but NOT in LOCAL (${inRailwayNotLocal.length}):`);
      inRailwayNotLocal.forEach(v => console.log(`     - ${v}`));
    }
    
    if (inLocalNotRailway.length === 0 && inRailwayNotLocal.length === 0) {
      console.log(`\n   ✅ Both databases have the same enum values`);
    }
    
    // Check if withholding_tax_payable is missing in Railway
    if (railwayResult.missing.includes('withholding_tax_payable')) {
      console.log(`\n   ⚠️  ISSUE FOUND: 'withholding_tax_payable' is missing in Railway!`);
      console.log(`      This is causing the error you're experiencing.`);
      console.log(`      We need to create a migration to add this enum value.`);
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  
  // Close connections
  try {
    await localSequelize.close();
  } catch (e) {}
  
  try {
    await railwaySequelize.close();
  } catch (e) {}
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

