#!/usr/bin/env node

/**
 * Analyze Database for Complete Migration
 * 
 * Lists all components that will be included in a complete database migration
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const sequelize = require('../config/database');

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  Complete Database Migration Analysis                         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    // 1. Get all tables
    const tables = await sequelize.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('📊 1. TABLES');
    console.log('═'.repeat(80));
    console.log(`Total: ${tables.length} tables\n`);
    tables.forEach((t, idx) => {
      console.log(`   ${(idx + 1).toString().padStart(3)}. ${t.table_name}`);
    });
    console.log('');
    
    // 2. Get all enums
    const enums = await sequelize.query(`
      SELECT 
        t.typname as enum_name,
        string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as enum_values
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname NOT LIKE 'pg_%'
      GROUP BY t.typname
      ORDER BY t.typname;
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('📝 2. ENUM TYPES');
    console.log('═'.repeat(80));
    console.log(`Total: ${enums.length} enum types\n`);
    enums.forEach((e, idx) => {
      console.log(`   ${(idx + 1).toString().padStart(3)}. ${e.enum_name}`);
      console.log(`      Values: ${e.enum_values}`);
      console.log('');
    });
    
    // 3. Get all sequences
    const sequences = await sequelize.query(`
      SELECT 
        sequence_name,
        data_type,
        start_value,
        increment
      FROM information_schema.sequences
      WHERE sequence_schema = 'public'
      ORDER BY sequence_name;
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('🔢 3. SEQUENCES');
    console.log('═'.repeat(80));
    console.log(`Total: ${sequences.length} sequences\n`);
    sequences.forEach((s, idx) => {
      console.log(`   ${(idx + 1).toString().padStart(3)}. ${s.sequence_name} (${s.data_type}, start: ${s.start_value}, increment: ${s.increment})`);
    });
    console.log('');
    
    // 4. Get all constraints per table
    console.log('═'.repeat(80));
    console.log('🔗 4. CONSTRAINTS (Summary)');
    console.log('═'.repeat(80));
    console.log('');
    
    let totalConstraints = 0;
    let totalPrimaryKeys = 0;
    let totalForeignKeys = 0;
    let totalUnique = 0;
    let totalCheck = 0;
    
    for (const table of tables) {
      const constraints = await sequelize.query(`
        SELECT 
          tc.constraint_name,
          tc.constraint_type,
          string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public' 
          AND tc.table_name = :tableName
        GROUP BY tc.constraint_name, tc.constraint_type
        ORDER BY tc.constraint_type, tc.constraint_name;
      `, {
        replacements: { tableName: table.table_name },
        type: sequelize.QueryTypes.SELECT
      });
      
      if (constraints && constraints.length > 0) {
        const byType = {};
        constraints.forEach(c => {
          if (!byType[c.constraint_type]) byType[c.constraint_type] = [];
          byType[c.constraint_type].push(c);
        });
        
        totalConstraints += constraints.length;
        totalPrimaryKeys += (byType['PRIMARY KEY'] || []).length;
        totalForeignKeys += (byType['FOREIGN KEY'] || []).length;
        totalUnique += (byType['UNIQUE'] || []).length;
        totalCheck += (byType['CHECK'] || []).length;
      }
    }
    
    console.log(`   Primary Keys: ${totalPrimaryKeys}`);
    console.log(`   Foreign Keys: ${totalForeignKeys}`);
    console.log(`   Unique Constraints: ${totalUnique}`);
    console.log(`   Check Constraints: ${totalCheck}`);
    console.log(`   Total Constraints: ${totalConstraints}`);
    console.log('');
    
    // 5. Get all indexes
    const indexes = await sequelize.query(`
      SELECT
        COUNT(*) as total_indexes,
        COUNT(CASE WHEN idx.indisunique THEN 1 END) as unique_indexes,
        COUNT(CASE WHEN idx.indisprimary THEN 1 END) as primary_indexes
      FROM pg_indexes i
      JOIN pg_index idx ON i.indexname = (
        SELECT relname FROM pg_class WHERE oid = idx.indexrelid
      )
      WHERE i.schemaname = 'public';
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('📑 5. INDEXES');
    console.log('═'.repeat(80));
    console.log('');
    if (indexes && indexes.length > 0) {
      console.log(`   Total Indexes: ${indexes[0].total_indexes}`);
      console.log(`   Unique Indexes: ${indexes[0].unique_indexes}`);
      console.log(`   Primary Indexes: ${indexes[0].primary_indexes}`);
      console.log(`   Regular Indexes: ${indexes[0].total_indexes - indexes[0].unique_indexes}`);
    }
    console.log('');
    
    // 6. Get all functions/triggers
    const triggers = await sequelize.query(`
      SELECT COUNT(*) as total_triggers
      FROM information_schema.triggers
      WHERE trigger_schema = 'public';
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    const functions = await sequelize.query(`
      SELECT COUNT(*) as total_functions
      FROM pg_proc
      WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    console.log('═'.repeat(80));
    console.log('⚙️  6. FUNCTIONS & TRIGGERS');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`   Triggers: ${triggers[0]?.total_triggers || 0}`);
    console.log(`   Functions: ${functions[0]?.total_functions || 0}`);
    console.log('');
    
    // Summary
    console.log('═'.repeat(80));
    console.log('📋 MIGRATION WILL INCLUDE:');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`   1. ${tables.length} Tables with:`);
    console.log(`      - All columns (data types, nullability, defaults)`);
    console.log(`      - All primary keys`);
    console.log(`      - All foreign keys`);
    console.log(`      - All unique constraints`);
    console.log(`      - All check constraints`);
    console.log(`      - All indexes`);
    console.log('');
    console.log(`   2. ${enums.length} Enum Types with all their values`);
    console.log('');
    console.log(`   3. ${sequences.length} Sequences`);
    console.log('');
    console.log(`   4. ${triggers[0]?.total_triggers || 0} Triggers (if any)`);
    console.log('');
    console.log(`   5. ${functions[0]?.total_functions || 0} Functions (if any)`);
    console.log('');
    console.log('═'.repeat(80));
    console.log('✅ Analysis Complete!');
    console.log('═'.repeat(80));
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main().catch(console.error);

