#!/usr/bin/env node

/**
 * Complete Database Schema Reader
 * Reads all tables, columns, constraints, and indexes from the database
 */

const { Sequelize, QueryTypes } = require('sequelize');
const config = require('../env');

const sequelize = new Sequelize({
  database: config.DB_NAME,
  username: config.DB_USER,
  password: config.DB_PASSWORD,
  host: config.DB_HOST,
  port: config.DB_PORT,
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' && config.DB_HOST !== 'localhost' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});

async function getAllTables() {
  const tables = await sequelize.query(`
    SELECT 
      table_name,
      table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `, { type: QueryTypes.SELECT });
  
  return tables.map(t => t.table_name);
}

async function getTableColumns(tableName) {
  const columns = await sequelize.query(`
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
    AND table_name = :tableName
    ORDER BY ordinal_position;
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return columns;
}

async function getTableConstraints(tableName) {
  const constraints = await sequelize.query(`
    SELECT 
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
    AND tc.table_name = :tableName
    ORDER BY tc.constraint_type, tc.constraint_name;
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return constraints;
}

async function getTableIndexes(tableName) {
  const indexes = await sequelize.query(`
    SELECT 
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = :tableName
    ORDER BY indexname;
  `, {
    replacements: { tableName },
    type: QueryTypes.SELECT
  });
  
  return indexes;
}

async function getEnumTypes() {
  const enums = await sequelize.query(`
    SELECT 
      t.typname AS enum_name,
      e.enumlabel AS enum_value
    FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid  
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder;
  `, { type: QueryTypes.SELECT });
  
  return enums;
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database:', config.DB_NAME);
    console.log('📍 Host:', config.DB_HOST + ':' + config.DB_PORT);
    console.log('👤 User:', config.DB_USER);
    console.log('\n');

    // Get all tables
    const tables = await getAllTables();
    console.log(`📊 Found ${tables.length} tables\n`);

    const schema = {
      database: config.DB_NAME,
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      tables: {},
      enums: {}
    };

    // Get enum types
    console.log('📋 Reading ENUM types...');
    const enums = await getEnumTypes();
    enums.forEach(enumItem => {
      if (!schema.enums[enumItem.enum_name]) {
        schema.enums[enumItem.enum_name] = [];
      }
      schema.enums[enumItem.enum_name].push(enumItem.enum_value);
    });
    console.log(`   Found ${Object.keys(schema.enums).length} enum types\n`);

    // Process each table
    for (const tableName of tables) {
      console.log(`📋 Processing table: ${tableName}...`);
      
      const columns = await getTableColumns(tableName);
      const constraints = await getTableConstraints(tableName);
      const indexes = await getTableIndexes(tableName);

      schema.tables[tableName] = {
        columns: columns.map(col => ({
          name: col.column_name,
          type: col.data_type,
          udt_name: col.udt_name,
          max_length: col.character_maximum_length,
          precision: col.numeric_precision,
          scale: col.numeric_scale,
          nullable: col.is_nullable === 'YES',
          default: col.column_default,
          position: col.ordinal_position
        })),
        constraints: constraints.map(con => ({
          name: con.constraint_name,
          type: con.constraint_type,
          column: con.column_name,
          foreign_table: con.foreign_table_name,
          foreign_column: con.foreign_column_name
        })),
        indexes: indexes.map(idx => ({
          name: idx.indexname,
          definition: idx.indexdef
        }))
      };
    }

    // Output summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 DATABASE SCHEMA SUMMARY');
    console.log('='.repeat(80));
    console.log(`Database: ${schema.database}`);
    console.log(`Total Tables: ${tables.length}`);
    console.log(`Total Enum Types: ${Object.keys(schema.enums).length}`);
    
    let totalColumns = 0;
    let totalConstraints = 0;
    let totalIndexes = 0;
    
    Object.values(schema.tables).forEach(table => {
      totalColumns += table.columns.length;
      totalConstraints += table.constraints.length;
      totalIndexes += table.indexes.length;
    });
    
    console.log(`Total Columns: ${totalColumns}`);
    console.log(`Total Constraints: ${totalConstraints}`);
    console.log(`Total Indexes: ${totalIndexes}`);
    console.log('='.repeat(80) + '\n');

    // Output detailed table information
    console.log('\n📋 DETAILED TABLE INFORMATION\n');
    
    for (const tableName of tables) {
      const table = schema.tables[tableName];
      
      console.log('='.repeat(80));
      console.log(`TABLE: ${tableName.toUpperCase()}`);
      console.log('='.repeat(80));
      
      console.log(`\n📊 COLUMNS (${table.columns.length}):`);
      console.log('-'.repeat(80));
      table.columns.forEach((col, idx) => {
        let typeStr = col.type;
        if (col.max_length) {
          typeStr += `(${col.max_length})`;
        } else if (col.precision && col.scale) {
          typeStr += `(${col.precision},${col.scale})`;
        }
        if (col.udt_name && col.udt_name !== col.type) {
          typeStr += ` [${col.udt_name}]`;
        }
        
        const nullable = col.nullable ? 'NULL' : 'NOT NULL';
        const defaultStr = col.default ? ` DEFAULT ${col.default}` : '';
        
        console.log(`  ${(idx + 1).toString().padStart(3)}. ${col.name.padEnd(40)} ${typeStr.padEnd(30)} ${nullable}${defaultStr}`);
      });
      
      if (table.constraints.length > 0) {
        console.log(`\n🔗 CONSTRAINTS (${table.constraints.length}):`);
        console.log('-'.repeat(80));
        table.constraints.forEach((con, idx) => {
          let constraintStr = `${con.type}: ${con.name}`;
          if (con.column) {
            constraintStr += ` (${con.column})`;
          }
          if (con.foreign_table) {
            constraintStr += ` → ${con.foreign_table}.${con.foreign_column}`;
          }
          console.log(`  ${(idx + 1).toString().padStart(3)}. ${constraintStr}`);
        });
      }
      
      if (table.indexes.length > 0) {
        console.log(`\n📇 INDEXES (${table.indexes.length}):`);
        console.log('-'.repeat(80));
        table.indexes.forEach((idx, idxNum) => {
          console.log(`  ${(idxNum + 1).toString().padStart(3)}. ${idx.name}`);
          console.log(`      ${idx.definition}`);
        });
      }
      
      console.log('\n');
    }

    // Output enum types
    if (Object.keys(schema.enums).length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('📋 ENUM TYPES');
      console.log('='.repeat(80));
      for (const [enumName, values] of Object.entries(schema.enums)) {
        console.log(`\n${enumName}:`);
        console.log(`  Values: ${values.join(', ')}`);
      }
      console.log('\n');
    }

    // Save to JSON file
    const fs = require('fs');
    const path = require('path');
    const outputPath = path.join(__dirname, '..', 'DATABASE_SCHEMA_COMPLETE.json');
    fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
    console.log(`\n✅ Schema saved to: ${outputPath}`);

    await sequelize.close();
    console.log('\n✅ Done!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

