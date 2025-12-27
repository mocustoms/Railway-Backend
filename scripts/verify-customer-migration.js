/**
 * Verify Customer Migration
 * Checks that the customer unique constraints migration was applied correctly
 */

const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');

// Parse Railway database URL
function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) return null;
  
  try {
    let normalizedUrl = databaseUrl.trim();
    if (!normalizedUrl.startsWith('postgres://') && !normalizedUrl.startsWith('postgresql://')) {
      return null;
    }
    
    normalizedUrl = normalizedUrl.replace(/^postgresql:\/\//, 'postgres://');
    const url = new URL(normalizedUrl);
    
    const databaseName = url.pathname ? url.pathname.slice(1) : '';
    if (!databaseName) return null;
    
    return {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: databaseName,
      username: url.username || 'postgres',
      password: url.password || ''
    };
  } catch (error) {
    return null;
  }
}

async function verifyDatabase(sequelizeInstance, dbName) {
  try {
    console.log(`\n🔍 Verifying ${dbName}...`);
    console.log('─'.repeat(60));
    
    // Get all indexes on customers table
    const indexes = await sequelizeInstance.query(
      `SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'customers'
        AND (indexname LIKE '%customer_id%' OR indexname LIKE '%full_name%')
      ORDER BY indexname;`,
      { type: sequelizeInstance.QueryTypes.SELECT }
    );

    // Check for required indexes
    const customerIdCompanyIndex = indexes.find(idx => 
      idx.indexname === 'customers_customer_id_companyId_unique'
    );
    
    const fullNameCompanyIndex = indexes.find(idx => 
      idx.indexname === 'customers_full_name_companyId_unique'
    );

    const globalCustomerIdIndexes = indexes.filter(idx => 
      idx.indexname.includes('customer_id') && 
      !idx.indexname.includes('companyId') &&
      idx.indexdef.includes('UNIQUE') &&
      idx.indexname !== 'customers_pkey'
    );

    const globalFullNameIndexes = indexes.filter(idx => 
      idx.indexname.includes('full_name') && 
      !idx.indexname.includes('companyId') &&
      idx.indexdef.includes('UNIQUE')
    );

    // Display results
    console.log(`\n📊 Found ${indexes.length} relevant indexes:\n`);
    indexes.forEach(idx => {
      const isGlobal = (idx.indexname.includes('customer_id') || idx.indexname.includes('full_name')) &&
                       !idx.indexname.includes('companyId') &&
                       idx.indexdef.includes('UNIQUE') &&
                       idx.indexname !== 'customers_pkey';
      const marker = isGlobal ? '⚠️  ' : '✅ ';
      console.log(`${marker}${idx.indexname}`);
      console.log(`   ${idx.indexdef}\n`);
    });

    // Status summary
    console.log('\n📋 Status Summary:');
    console.log('─'.repeat(60));
    
    if (customerIdCompanyIndex) {
      console.log('✅ customers_customer_id_companyId_unique: EXISTS');
    } else {
      console.log('❌ customers_customer_id_companyId_unique: MISSING');
    }
    
    if (fullNameCompanyIndex) {
      console.log('✅ customers_full_name_companyId_unique: EXISTS');
    } else {
      console.log('❌ customers_full_name_companyId_unique: MISSING');
    }
    
    if (globalCustomerIdIndexes.length > 0) {
      console.log(`⚠️  Global unique indexes on customer_id: ${globalCustomerIdIndexes.length} (should be 0)`);
      globalCustomerIdIndexes.forEach(idx => console.log(`   - ${idx.indexname}`));
    } else {
      console.log('✅ Global unique indexes on customer_id: NONE (correct)');
    }
    
    if (globalFullNameIndexes.length > 0) {
      console.log(`⚠️  Global unique indexes on full_name: ${globalFullNameIndexes.length} (should be 0)`);
      globalFullNameIndexes.forEach(idx => console.log(`   - ${idx.indexname}`));
    } else {
      console.log('✅ Global unique indexes on full_name: NONE (correct)');
    }

    // Overall status
    const allGood = customerIdCompanyIndex && 
                    fullNameCompanyIndex && 
                    globalCustomerIdIndexes.length === 0 && 
                    globalFullNameIndexes.length === 0;

    if (allGood) {
      console.log('\n✅ VERIFICATION PASSED: All indexes are correctly configured');
    } else {
      console.log('\n❌ VERIFICATION FAILED: Some indexes are missing or incorrect');
    }

    return allGood;
  } catch (error) {
    console.error(`\n❌ Error verifying ${dbName}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('\n🔍 VERIFYING CUSTOMER MIGRATION');
  console.log('='.repeat(60));
  
  let localPassed = false;
  let railwayPassed = false;

  // Verify local database
  try {
    await sequelize.authenticate();
    localPassed = await verifyDatabase(sequelize, 'LOCAL DATABASE');
    await sequelize.close();
  } catch (error) {
    console.error('\n❌ Error connecting to local database:', error.message);
  }

  // Verify Railway database
  const railwayUrl = process.argv[2] || process.env.RAILWAY_DATABASE_URL;
  if (railwayUrl) {
    const railwayConfig = parseDatabaseUrl(railwayUrl);
    if (railwayConfig) {
      try {
        const railwaySequelize = new Sequelize(
          railwayConfig.database,
          railwayConfig.username,
          railwayConfig.password,
          {
            host: railwayConfig.host,
            port: railwayConfig.port,
            dialect: 'postgres',
            logging: false
          }
        );
        
        await railwaySequelize.authenticate();
        railwayPassed = await verifyDatabase(railwaySequelize, 'RAILWAY DATABASE');
        await railwaySequelize.close();
      } catch (error) {
        console.error('\n❌ Error connecting to Railway database:', error.message);
      }
    } else {
      console.log('\n⚠️  Railway database URL not provided or invalid');
      console.log('   Usage: node scripts/verify-customer-migration.js [railway-database-url]');
    }
  } else {
    console.log('\n⚠️  Railway database URL not provided');
    console.log('   Usage: node scripts/verify-customer-migration.js [railway-database-url]');
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Local Database:    ${localPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (railwayUrl) {
    console.log(`Railway Database:  ${railwayPassed ? '✅ PASSED' : '❌ FAILED'}`);
  }
  console.log('='.repeat(60) + '\n');
  
  process.exit(localPassed && (railwayUrl ? railwayPassed : true) ? 0 : 1);
}

main().catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});

