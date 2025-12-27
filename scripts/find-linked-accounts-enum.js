const { Sequelize, QueryTypes } = require('sequelize');

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

async function findEnum() {
  const railwayDbUrl = process.argv[2] || 'postgres://postgres:bHgyHEtSVvBYcMPRGKvbigMiJZSPoSeo@nozomi.proxy.rlwy.net:33624/railway';
  
  console.log('🔍 Finding linked accounts enum...\n');
  
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
    
    // First, check if linked_accounts table exists
    const [tableExists] = await railwaySequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'linked_accounts'
      );
    `, { type: QueryTypes.SELECT });
    
    if (!tableExists || !tableExists.exists) {
      console.log('❌ linked_accounts table does not exist!');
      return;
    }
    
    console.log('✅ linked_accounts table exists\n');
    
    // Get the column definition
    const columnInfo = await railwaySequelize.query(`
      SELECT 
        column_name,
        data_type,
        udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'linked_accounts'
        AND column_name = 'account_type';
    `, { type: QueryTypes.SELECT });
    
    const columnData = Array.isArray(columnInfo) && columnInfo.length > 0 
      ? (Array.isArray(columnInfo[0]) ? columnInfo[0][0] : columnInfo[0])
      : null;
    
    if (!columnData) {
      console.log('❌ account_type column not found!');
      return;
    }
    
    const column = columnData;
    console.log('📋 Column info:');
    console.log(`   Column: ${column.column_name}`);
    console.log(`   Data Type: ${column.data_type}`);
    console.log(`   UDT Name: ${column.udt_name}\n`);
    
    // Now get enum values using the actual UDT name
    const enumValuesResult = await railwaySequelize.query(`
      SELECT e.enumlabel as value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname = :enumName
      ORDER BY e.enumsortorder;
    `, {
      replacements: { enumName: column.udt_name },
      type: QueryTypes.SELECT
    });
    
    // Handle different result formats
    let enumValues = [];
    if (Array.isArray(enumValuesResult)) {
      if (enumValuesResult.length > 0 && Array.isArray(enumValuesResult[0])) {
        enumValues = enumValuesResult[0];
      } else {
        enumValues = enumValuesResult;
      }
    }
    
    const values = enumValues.map(e => {
      if (typeof e === 'string') return e;
      if (e && e.value) return e.value;
      if (e && e.enumlabel) return e.enumlabel;
      return String(e);
    }).filter(v => v);
    
    console.log(`📋 Found ${values.length} enum values in ${column.udt_name}:\n`);
    values.forEach((v, i) => {
      const marker = v === 'withholding_tax_payable' ? '✅' : '  ';
      console.log(`${marker} ${i + 1}. ${v}`);
    });
    
    console.log('');
    
    if (values.includes('withholding_tax_payable')) {
      console.log('✅ SUCCESS: "withholding_tax_payable" is present!');
    } else {
      console.log('❌ ERROR: "withholding_tax_payable" is NOT present.');
      console.log(`   Current enum name: ${column.udt_name}`);
      console.log('   We need to add it to this enum.');
    }
    
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    throw error;
  } finally {
    await railwaySequelize.close();
  }
}

findEnum().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

