const { Sequelize, QueryTypes } = require('sequelize');

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

async function verify() {
  const railwayDbUrl = process.argv[2] || 'postgres://postgres:bHgyHEtSVvBYcMPRGKvbigMiJZSPoSeo@nozomi.proxy.rlwy.net:33624/railway';
  
  console.log('🔍 Verifying enum value on Railway...\n');
  
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
    
    // Get all enum values for enum_linked_accounts_account_type
    const [enumValues] = await railwaySequelize.query(`
      SELECT e.enumlabel as value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname = 'enum_linked_accounts_account_type'
      ORDER BY e.enumsortorder;
    `, {
      type: QueryTypes.SELECT
    });
    
    const values = Array.isArray(enumValues) ? enumValues.map(e => e.value) : [];
    
    console.log(`📋 Found ${values.length} enum values in enum_linked_accounts_account_type:\n`);
    values.forEach((v, i) => {
      const marker = v === 'withholding_tax_payable' ? '✅' : '  ';
      console.log(`${marker} ${i + 1}. ${v}`);
    });
    
    console.log('');
    
    if (values.includes('withholding_tax_payable')) {
      console.log('✅ SUCCESS: "withholding_tax_payable" is present in the enum!');
      console.log('   The migration was successful. You can now use this enum value.');
    } else {
      console.log('❌ ERROR: "withholding_tax_payable" is NOT present in the enum.');
      console.log('   The migration may have failed or the enum value was not added.');
    }
    
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await railwaySequelize.close();
  }
}

verify().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

