const { Sequelize } = require('sequelize');
const config = require('../env');

const RAILWAY_URL = 'postgresql://postgres:sonLgAojCEeVgUSRrBgwtKBIWGppifVp@ballast.proxy.rlwy.net:36079/railway';

// Local database connection
const localSequelize = new Sequelize(
  config.DB_NAME,
  config.DB_USER,
  config.DB_PASSWORD,
  {
    host: config.DB_HOST,
    port: config.DB_PORT,
    dialect: 'postgres',
    logging: false
  }
);

// Railway database connection
const railwaySequelize = new Sequelize(RAILWAY_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  logging: false
});

async function getTableInfo(sequelize, name) {
  try {
    // Check if table exists
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = '${name}'
    `);
    
    if (tables.length === 0) {
      return { exists: false, columns: [], constraints: [], indexes: [] };
    }
    
    // Get columns
    const [columns] = await sequelize.query(`
      SELECT 
        column_name,
        data_type,
        udt_name,
        character_maximum_length,
        is_nullable,
        column_default,
        ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = '${name}'
      ORDER BY ordinal_position
    `);
    
    // Get constraints
    const [constraints] = await sequelize.query(`
      SELECT 
        constraint_name,
        constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
      AND table_name = '${name}'
    `);
    
    // Get indexes
    const [indexes] = await sequelize.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename = '${name}'
    `);
    
    return {
      exists: true,
      columns: columns,
      constraints: constraints,
      indexes: indexes
    };
  } catch (error) {
    throw error;
  }
}

async function compare() {
  try {
    console.log('🔍 Comparing linked_accounts table schema...\n');
    
    // Connect to both databases
    console.log('📡 Connecting to local database...');
    await localSequelize.authenticate();
    console.log('✅ Local database connected\n');
    
    console.log('📡 Connecting to Railway database...');
    await railwaySequelize.authenticate();
    console.log('✅ Railway database connected\n');
    
    // Get table info from both
    console.log('📋 Fetching table information...\n');
    const localInfo = await getTableInfo(localSequelize, 'linked_accounts');
    const railwayInfo = await getTableInfo(railwaySequelize, 'linked_accounts');
    
    // Compare existence
    console.log('='.repeat(80));
    console.log('📊 COMPARISON RESULTS');
    console.log('='.repeat(80));
    console.log(`\nLocal:    ${localInfo.exists ? '✅ EXISTS' : '❌ NOT FOUND'}`);
    console.log(`Railway:  ${railwayInfo.exists ? '✅ EXISTS' : '❌ NOT FOUND'}\n`);
    
    if (!localInfo.exists && !railwayInfo.exists) {
      console.log('⚠️  Table does not exist in either database');
      await localSequelize.close();
      await railwaySequelize.close();
      return;
    }
    
    if (!localInfo.exists) {
      console.log('⚠️  Table exists on Railway but not locally');
      await localSequelize.close();
      await railwaySequelize.close();
      return;
    }
    
    if (!railwayInfo.exists) {
      console.log('⚠️  Table exists locally but not on Railway');
      await localSequelize.close();
      await railwaySequelize.close();
      return;
    }
    
    // Compare columns
    console.log('📋 COLUMNS COMPARISON:');
    console.log('-'.repeat(80));
    
    const localCols = localInfo.columns.map(c => c.column_name);
    const railwayCols = railwayInfo.columns.map(c => c.column_name);
    
    const allCols = [...new Set([...localCols, ...railwayCols])].sort();
    
    let columnsMatch = true;
    allCols.forEach(colName => {
      const localCol = localInfo.columns.find(c => c.column_name === colName);
      const railwayCol = railwayInfo.columns.find(c => c.column_name === colName);
      
      if (!localCol) {
        console.log(`❌ ${colName}: Missing in LOCAL`);
        columnsMatch = false;
      } else if (!railwayCol) {
        console.log(`❌ ${colName}: Missing in RAILWAY`);
        columnsMatch = false;
      } else {
        const localType = localCol.udt_name || localCol.data_type;
        const railwayType = railwayCol.udt_name || railwayCol.data_type;
        const localNullable = localCol.is_nullable;
        const railwayNullable = railwayCol.is_nullable;
        
        if (localType !== railwayType || localNullable !== railwayNullable) {
          console.log(`⚠️  ${colName}:`);
          console.log(`     Local:   ${localType} (nullable: ${localNullable})`);
          console.log(`     Railway: ${railwayType} (nullable: ${railwayNullable})`);
          columnsMatch = false;
        } else {
          console.log(`✅ ${colName}: ${localType} (nullable: ${localNullable})`);
        }
      }
    });
    
    // Compare constraints
    console.log('\n🔒 CONSTRAINTS COMPARISON:');
    console.log('-'.repeat(80));
    
    const localConstraints = localInfo.constraints.map(c => c.constraint_name).sort();
    const railwayConstraints = railwayInfo.constraints.map(c => c.constraint_name).sort();
    
    if (JSON.stringify(localConstraints) === JSON.stringify(railwayConstraints)) {
      console.log('✅ Constraints match');
      localInfo.constraints.forEach(c => {
        console.log(`   - ${c.constraint_name} (${c.constraint_type})`);
      });
    } else {
      console.log('⚠️  Constraints differ:');
      console.log(`   Local:   ${localConstraints.join(', ') || 'None'}`);
      console.log(`   Railway: ${railwayConstraints.join(', ') || 'None'}`);
    }
    
    // Compare indexes
    console.log('\n📇 INDEXES COMPARISON:');
    console.log('-'.repeat(80));
    
    const localIndexes = localInfo.indexes.map(i => i.indexname).sort();
    const railwayIndexes = railwayInfo.indexes.map(i => i.indexname).sort();
    
    if (JSON.stringify(localIndexes) === JSON.stringify(railwayIndexes)) {
      console.log('✅ Indexes match');
      localInfo.indexes.forEach(i => {
        console.log(`   - ${i.indexname}`);
      });
    } else {
      console.log('⚠️  Indexes differ:');
      console.log(`   Local:   ${localIndexes.join(', ') || 'None'}`);
      console.log(`   Railway: ${railwayIndexes.join(', ') || 'None'}`);
    }
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    
    if (columnsMatch && 
        JSON.stringify(localConstraints) === JSON.stringify(railwayConstraints) &&
        JSON.stringify(localIndexes) === JSON.stringify(railwayIndexes)) {
      console.log('✅ Schemas MATCH - Local and Railway are identical');
    } else {
      console.log('⚠️  Schemas DIFFER - Review differences above');
    }
    
    console.log(`\nLocal columns:   ${localInfo.columns.length}`);
    console.log(`Railway columns: ${railwayInfo.columns.length}`);
    console.log(`Local constraints:   ${localInfo.constraints.length}`);
    console.log(`Railway constraints: ${railwayInfo.constraints.length}`);
    console.log(`Local indexes:   ${localInfo.indexes.length}`);
    console.log(`Railway indexes: ${railwayInfo.indexes.length}`);
    
    await localSequelize.close();
    await railwaySequelize.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

compare();

