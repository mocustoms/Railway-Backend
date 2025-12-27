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

async function getEnumValues(sequelize, enumName) {
  try {
    const [results] = await sequelize.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = '${enumName}'
      )
      ORDER BY enumsortorder
    `);
    return results.map(r => r.enumlabel);
  } catch (error) {
    return null;
  }
}

async function getColumnDetails(sequelize, tableName) {
  const [columns] = await sequelize.query(`
    SELECT 
      column_name,
      data_type,
      udt_name,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      is_nullable,
      column_default,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = '${tableName}'
    ORDER BY ordinal_position
  `);
  return columns;
}

async function getForeignKeys(sequelize, tableName) {
  const [fks] = await sequelize.query(`
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = '${tableName}'
    ORDER BY tc.constraint_name, kcu.ordinal_position
  `);
  return fks;
}

async function getUniqueConstraints(sequelize, tableName) {
  const [constraints] = await sequelize.query(`
    SELECT
      tc.constraint_name,
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'UNIQUE'
    AND tc.table_name = '${tableName}'
    GROUP BY tc.constraint_name
    ORDER BY tc.constraint_name
  `);
  return constraints;
}

async function verifySchema() {
  try {
    console.log('🔍 VERIFYING LINKED_ACCOUNTS SCHEMA MATCH\n');
    console.log('='.repeat(80));
    
    // Connect to both databases
    console.log('📡 Connecting to databases...');
    await localSequelize.authenticate();
    await railwaySequelize.authenticate();
    console.log('✅ Both databases connected\n');
    
    // Check enum type
    console.log('📋 Checking enum_linked_account_type...');
    const localEnum = await getEnumValues(localSequelize, 'enum_linked_account_type');
    const railwayEnum = await getEnumValues(railwaySequelize, 'enum_linked_account_type');
    
    let enumMatch = false;
    if (localEnum && railwayEnum) {
      enumMatch = JSON.stringify(localEnum) === JSON.stringify(railwayEnum);
      console.log(`Local:   ${localEnum.join(', ')}`);
      console.log(`Railway: ${railwayEnum.join(', ')}`);
      console.log(enumMatch ? '✅ Enum values MATCH' : '❌ Enum values DIFFER');
      if (!enumMatch) {
        console.log('⚠️  SCHEMA MISMATCH: Enum values differ');
        await localSequelize.close();
        await railwaySequelize.close();
        return;
      }
    } else {
      console.log('⚠️  Could not retrieve enum values');
    }
    console.log('');
    
    // Get column details
    console.log('📋 Comparing column definitions...');
    const localColumns = await getColumnDetails(localSequelize, 'linked_accounts');
    const railwayColumns = await getColumnDetails(railwaySequelize, 'linked_accounts');
    
    let columnsMatch = true;
    const columnDetails = [];
    
    for (let i = 0; i < Math.max(localColumns.length, railwayColumns.length); i++) {
      const local = localColumns[i];
      const railway = railwayColumns[i];
      
      if (!local || !railway) {
        console.log(`❌ Column count mismatch`);
        columnsMatch = false;
        break;
      }
      
      const match = 
        local.column_name === railway.column_name &&
        local.udt_name === railway.udt_name &&
        local.is_nullable === railway.is_nullable &&
        local.character_maximum_length === railway.character_maximum_length &&
        local.numeric_precision === railway.numeric_precision &&
        local.numeric_scale === railway.numeric_scale;
      
      columnDetails.push({
        name: local.column_name,
        match: match,
        local: local,
        railway: railway
      });
      
      if (!match) {
        columnsMatch = false;
      }
    }
    
    if (columnsMatch) {
      console.log('✅ All column definitions MATCH');
      columnDetails.forEach(col => {
        console.log(`   ✅ ${col.name}: ${col.local.udt_name} (nullable: ${col.local.is_nullable})`);
      });
    } else {
      console.log('❌ Column definitions DIFFER:');
      columnDetails.forEach(col => {
        if (!col.match) {
          console.log(`   ❌ ${col.name}:`);
          console.log(`      Local:   ${col.local.udt_name} (nullable: ${col.local.is_nullable})`);
          console.log(`      Railway: ${col.railway.udt_name} (nullable: ${col.railway.is_nullable})`);
        }
      });
    }
    console.log('');
    
    // Check foreign keys
    console.log('🔗 Comparing foreign keys...');
    const localFKs = await getForeignKeys(localSequelize, 'linked_accounts');
    const railwayFKs = await getForeignKeys(railwaySequelize, 'linked_accounts');
    
    const fkMatch = localFKs.length === railwayFKs.length &&
      localFKs.every((localFK, i) => {
        const railwayFK = railwayFKs.find(fk => fk.column_name === localFK.column_name);
        return railwayFK &&
          railwayFK.foreign_table_name === localFK.foreign_table_name &&
          railwayFK.foreign_column_name === localFK.foreign_column_name &&
          railwayFK.delete_rule === localFK.delete_rule &&
          railwayFK.update_rule === localFK.update_rule;
      });
    
    if (fkMatch) {
      console.log('✅ Foreign keys MATCH');
      localFKs.forEach(fk => {
        console.log(`   ✅ ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name} (ON DELETE ${fk.delete_rule}, ON UPDATE ${fk.update_rule})`);
      });
    } else {
      console.log('❌ Foreign keys DIFFER');
      console.log(`   Local:   ${localFKs.length} foreign keys`);
      console.log(`   Railway: ${railwayFKs.length} foreign keys`);
    }
    console.log('');
    
    // Check unique constraints
    console.log('🔒 Comparing unique constraints...');
    const localUniques = await getUniqueConstraints(localSequelize, 'linked_accounts');
    const railwayUniques = await getUniqueConstraints(railwaySequelize, 'linked_accounts');
    
    const uniqueMatch = localUniques.length === railwayUniques.length &&
      localUniques.every(localU => {
        return railwayUniques.some(railwayU => railwayU.columns === localU.columns);
      });
    
    if (uniqueMatch) {
      console.log('✅ Unique constraints MATCH');
      localUniques.forEach(u => {
        console.log(`   ✅ ${u.constraint_name}: (${u.columns})`);
      });
    } else {
      console.log('❌ Unique constraints DIFFER');
      console.log(`   Local:   ${localUniques.map(u => u.columns).join(', ')}`);
      console.log(`   Railway: ${railwayUniques.map(u => u.columns).join(', ')}`);
    }
    console.log('');
    
    // Final verification
    console.log('='.repeat(80));
    console.log('📊 FINAL VERIFICATION');
    console.log('='.repeat(80));
    
    const allMatch = enumMatch && columnsMatch && fkMatch && uniqueMatch;
    
    if (allMatch) {
      console.log('✅✅✅ SCHEMA FULLY MATCHES ✅✅✅');
      console.log('\nAll aspects verified:');
      console.log('  ✅ Enum type definition');
      console.log('  ✅ Column definitions');
      console.log('  ✅ Foreign key constraints');
      console.log('  ✅ Unique constraints');
      console.log('\nLocal and Railway schemas are IDENTICAL');
    } else {
      console.log('❌❌❌ SCHEMA MISMATCH DETECTED ❌❌❌');
      console.log('\nMismatches found in:');
      if (!enumMatch) console.log('  ❌ Enum type definition');
      if (!columnsMatch) console.log('  ❌ Column definitions');
      if (!fkMatch) console.log('  ❌ Foreign key constraints');
      if (!uniqueMatch) console.log('  ❌ Unique constraints');
    }
    
    await localSequelize.close();
    await railwaySequelize.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

verifySchema();

