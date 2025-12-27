#!/usr/bin/env node

/**
 * Sync Database Schema from Local to Railway (Sequelize-based)
 * 
 * This script uses Sequelize to sync schema without requiring pg_dump/psql
 * It creates missing tables and columns directly using SQL queries
 */

require('dotenv').config();
const { QueryTypes } = require('sequelize');
const readline = require('readline');
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');

async function getTableColumns(sequelize, tableName) {
  const columns = await sequelize.query(
    `SELECT 
      c.column_name, 
      c.data_type, 
      c.is_nullable, 
      c.column_default, 
      c.character_maximum_length, 
      c.numeric_precision, 
      c.numeric_scale,
      CASE 
        WHEN c.data_type = 'USER-DEFINED' THEN t.typname
        ELSE NULL
      END as udt_name
     FROM information_schema.columns c
     LEFT JOIN pg_type t ON t.oid = (
       SELECT c2.udt_name::regtype::oid
       FROM information_schema.columns c2
       WHERE c2.table_schema = 'public' 
       AND c2.table_name = c.table_name
       AND c2.column_name = c.column_name
       LIMIT 1
     )
     WHERE c.table_schema = 'public' 
     AND c.table_name = :tableName
     ORDER BY c.ordinal_position`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0])
    ? columns[0]
    : columns;
}

async function getEnumTypes(sequelize) {
  // Get enum types with their values
  const enumTypes = await sequelize.query(
    `SELECT DISTINCT t.typname as enum_name
     FROM pg_type t 
     JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e'`,
    { type: QueryTypes.SELECT }
  );
  
  const result = Array.isArray(enumTypes) && enumTypes.length > 0 && Array.isArray(enumTypes[0]) ? enumTypes[0] : enumTypes;
  
  // For each enum, get its values
  const enumsWithValues = [];
  for (const enumType of result) {
    const values = await sequelize.query(
      `SELECT e.enumlabel as value
       FROM pg_type t 
       JOIN pg_enum e ON t.oid = e.enumtypid  
       WHERE t.typname = :enumName
       ORDER BY e.enumsortorder`,
      {
        replacements: { enumName: enumType.enum_name },
        type: QueryTypes.SELECT
      }
    );
    const valuesArray = Array.isArray(values) && values.length > 0 && Array.isArray(values[0]) ? values[0] : values;
    enumsWithValues.push({
      enum_name: enumType.enum_name,
      enum_values: valuesArray.map(v => v.value)
    });
  }
  
  return enumsWithValues;
}

async function getTableDefinition(sequelize, tableName) {
  const columns = await getTableColumns(sequelize, tableName);
  const constraints = await sequelize.query(
    `SELECT constraint_name, constraint_type
     FROM information_schema.table_constraints
     WHERE table_schema = 'public' AND table_name = :tableName`,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT
    }
  );
  return { columns, constraints: Array.isArray(constraints) && constraints.length > 0 && Array.isArray(constraints[0]) ? constraints[0] : constraints };
}

async function getTables(sequelize) {
  const tables = await sequelize.query(
    `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = 'public' 
     AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    { type: QueryTypes.SELECT }
  );
  const tablesArray = Array.isArray(tables) && tables.length > 0 && Array.isArray(tables[0])
    ? tables[0]
    : tables;
  return tablesArray.map(t => t.table_name);
}

function mapPostgresType(dataType, characterMaxLength, numericPrecision, numericScale, udtName = null) {
  // Handle enum types (USER-DEFINED)
  if (dataType === 'USER-DEFINED' && udtName) {
    return udtName;
  }
  
  const typeMap = {
    'character varying': characterMaxLength ? `VARCHAR(${characterMaxLength})` : 'TEXT',
    'varchar': characterMaxLength ? `VARCHAR(${characterMaxLength})` : 'TEXT',
    'character': characterMaxLength ? `CHAR(${characterMaxLength})` : 'CHAR(1)',
    'text': 'TEXT',
    'integer': 'INTEGER',
    'bigint': 'BIGINT',
    'smallint': 'SMALLINT',
    'numeric': numericPrecision && numericScale ? `NUMERIC(${numericPrecision},${numericScale})` : 'NUMERIC',
    'decimal': numericPrecision && numericScale ? `DECIMAL(${numericPrecision},${numericScale})` : 'DECIMAL',
    'real': 'REAL',
    'double precision': 'DOUBLE PRECISION',
    'boolean': 'BOOLEAN',
    'date': 'DATE',
    'timestamp without time zone': 'TIMESTAMP',
    'timestamp with time zone': 'TIMESTAMPTZ',
    'time without time zone': 'TIME',
    'uuid': 'UUID',
    'json': 'JSON',
    'jsonb': 'JSONB'
  };
  
  return typeMap[dataType.toLowerCase()] || dataType.toUpperCase();
}

function formatDefaultValue(defaultValue) {
  if (!defaultValue) return '';
  
  // Handle function calls like nextval(), CURRENT_TIMESTAMP, etc.
  if (/^(nextval|CURRENT_TIMESTAMP|CURRENT_DATE|NOW|uuid_generate|gen_random_uuid)/i.test(defaultValue)) {
    // Remove any quotes around function calls
    const cleaned = defaultValue.replace(/^['"]|['"]$/g, '');
    return `DEFAULT ${cleaned}`;
  }
  
  // If it's already a properly quoted string, use as is
  if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
    return `DEFAULT ${defaultValue}`;
  }
  
  // For boolean and numeric values, use as is
  if (defaultValue === 'true' || defaultValue === 'false' || defaultValue.match(/^[0-9.]+$/)) {
    return `DEFAULT ${defaultValue}`;
  }
  
  // For other string values, quote them
  return `DEFAULT '${defaultValue.replace(/'/g, "''")}'`;
}

async function createTable(railwaySequelize, tableName, localDefinition) {
  const columnDefs = localDefinition.columns.map(col => {
    const pgType = mapPostgresType(
      col.data_type,
      col.character_maximum_length,
      col.numeric_precision,
      col.numeric_scale,
      col.udt_name
    );
    const nullable = col.is_nullable === 'YES' ? '' : 'NOT NULL';
    // For enum defaults, extract just the value without the type cast
    let defaultValue = col.column_default;
    if (defaultValue && defaultValue.includes('::')) {
      defaultValue = defaultValue.split('::')[0];
    }
    const formattedDefault = formatDefaultValue(defaultValue);
    return `  "${col.column_name}" ${pgType} ${nullable} ${formattedDefault}`.trim();
  }).join(',\n');
  
  const createTableSQL = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${columnDefs}\n);`;
  
  try {
    await railwaySequelize.query(createTableSQL);
    console.log(`   ✅ Created table: ${tableName}`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to create table ${tableName}:`, error.message);
    console.error(`   SQL: ${createTableSQL.substring(0, 200)}...`);
    return false;
  }
}

async function addColumn(railwaySequelize, tableName, column) {
  const pgType = mapPostgresType(
    column.data_type,
    column.character_maximum_length,
    column.numeric_precision,
    column.numeric_scale,
    column.udt_name
  );
  const nullable = column.is_nullable === 'YES' ? '' : 'NOT NULL';
  // For enum defaults, extract just the value without the type cast
  let defaultValue = column.column_default;
  if (defaultValue && defaultValue.includes('::')) {
    defaultValue = defaultValue.split('::')[0];
  }
  const formattedDefault = formatDefaultValue(defaultValue);
  
  const alterTableSQL = `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${column.column_name}" ${pgType} ${nullable} ${formattedDefault}`.trim();
  
  try {
    await railwaySequelize.query(alterTableSQL);
    console.log(`   ✅ Added column: ${tableName}.${column.column_name}`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to add column ${tableName}.${column.column_name}:`, error.message);
    console.error(`   SQL: ${alterTableSQL}`);
    return false;
  }
}

async function syncEnums(localSequelize, railwaySequelize) {
  const localEnums = await getEnumTypes(localSequelize);
  const railwayEnums = await getEnumTypes(railwaySequelize);
  
  const railwayEnumNames = new Set((Array.isArray(railwayEnums) && railwayEnums.length > 0 && Array.isArray(railwayEnums[0]) ? railwayEnums[0] : railwayEnums).map(e => e.enum_name));
  
  const enumsToCreate = (Array.isArray(localEnums) && localEnums.length > 0 && Array.isArray(localEnums[0]) ? localEnums[0] : localEnums).filter(e => !railwayEnumNames.has(e.enum_name));
  
  if (enumsToCreate.length > 0) {
    console.log(`📋 Creating ${enumsToCreate.length} enum types...\n`);
    for (const enumDef of enumsToCreate) {
      const enumValues = Array.isArray(enumDef.enum_values) 
        ? enumDef.enum_values 
        : (enumDef.enum_values || '').split(',').map(v => v.trim());
      const enumValuesSQL = enumValues.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
      const createEnumSQL = `CREATE TYPE ${enumDef.enum_name} AS ENUM (${enumValuesSQL});`;
      try {
        await railwaySequelize.query(createEnumSQL);
        console.log(`   ✅ Created enum: ${enumDef.enum_name} (${enumValues.length} values)`);
      } catch (error) {
        // If enum already exists, that's okay
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          console.log(`   ⚠️  Enum ${enumDef.enum_name} already exists, skipping`);
        } else {
          console.error(`   ❌ Failed to create enum ${enumDef.enum_name}:`, error.message);
          console.error(`   SQL: ${createEnumSQL}`);
        }
      }
    }
    console.log('');
  }
}

async function syncSchemaToRailway() {
  const railwayDbUrl = process.argv[2];
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);

  const localSequelize = require('../config/database');
  const railwaySequelize = createRailwaySequelize(railwayUrl);

  try {
    console.log('\n🔄 SYNCING DATABASE SCHEMA FROM LOCAL TO RAILWAY (Sequelize-based)\n');
    console.log('='.repeat(80));
    
    await localSequelize.authenticate();
    console.log('✅ Connected to LOCAL database');
    
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');
    
    // First, sync enum types
    await syncEnums(localSequelize, railwaySequelize);

    const localTables = await getTables(localSequelize);
    const railwayTables = await getTables(railwaySequelize);
    
    console.log(`📊 Local tables: ${localTables.length}`);
    console.log(`📊 Railway tables: ${railwayTables.length}\n`);

    const missingInRailway = localTables.filter(t => !railwayTables.includes(t));
    const commonTables = localTables.filter(t => railwayTables.includes(t));

    if (missingInRailway.length > 0) {
      console.log(`📋 Creating ${missingInRailway.length} missing tables...\n`);
      
      for (const tableName of missingInRailway) {
        const localDef = await getTableDefinition(localSequelize, tableName);
        await createTable(railwaySequelize, tableName, localDef);
      }
      console.log('');
    }

    console.log(`📋 Checking columns in ${commonTables.length} common tables...\n`);
    
    let columnsAdded = 0;
    for (const tableName of commonTables) {
      const localColumns = await getTableColumns(localSequelize, tableName);
      const railwayColumns = await getTableColumns(railwaySequelize, tableName);
      
      const railwayColNames = new Set(railwayColumns.map(c => c.column_name));
      const missingColumns = localColumns.filter(c => !railwayColNames.has(c.column_name));
      
      if (missingColumns.length > 0) {
        console.log(`   📝 ${tableName}:`);
        for (const col of missingColumns) {
          await addColumn(railwaySequelize, tableName, col);
          columnsAdded++;
        }
      }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ SCHEMA SYNC COMPLETE!');
    console.log(`   Tables created: ${missingInRailway.length}`);
    console.log(`   Columns added: ${columnsAdded}`);
    console.log('='.repeat(80));
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Run: node scripts/compare-local-railway-schema.js to verify');
    console.log('   2. Test your application');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await localSequelize.close();
    await railwaySequelize.close();
  }
}

syncSchemaToRailway().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

