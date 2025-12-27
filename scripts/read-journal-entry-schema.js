#!/usr/bin/env node

/**
 * Read Journal Entry Database Schema
 * Gets the exact column names, types, and structure from the database
 */

const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function readJournalEntrySchema() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log('='.repeat(80));
    console.log('📊 JOURNAL ENTRY DATABASE SCHEMA');
    console.log('='.repeat(80));
    console.log('');

    // 1. Journal Entries Table Structure
    console.log('📝 JOURNAL_ENTRIES TABLE STRUCTURE');
    console.log('-'.repeat(80));
    const journalEntriesColumns = await sequelize.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'journal_entries'
      ORDER BY ordinal_position
    `, { type: QueryTypes.SELECT });

    console.log('Columns:');
    journalEntriesColumns.forEach((col, idx) => {
      let typeInfo = col.data_type;
      if (col.character_maximum_length) {
        typeInfo += `(${col.character_maximum_length})`;
      } else if (col.numeric_precision) {
        typeInfo += `(${col.numeric_precision},${col.numeric_scale || 0})`;
      }
      console.log(`  ${idx + 1}. ${col.column_name.padEnd(30)} ${typeInfo.padEnd(25)} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('');

    // 2. Journal Entry Lines Table Structure
    console.log('📋 JOURNAL_ENTRY_LINES TABLE STRUCTURE');
    console.log('-'.repeat(80));
    const journalEntryLinesColumns = await sequelize.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'journal_entry_lines'
      ORDER BY ordinal_position
    `, { type: QueryTypes.SELECT });

    console.log('Columns:');
    journalEntryLinesColumns.forEach((col, idx) => {
      let typeInfo = col.data_type;
      if (col.character_maximum_length) {
        typeInfo += `(${col.character_maximum_length})`;
      } else if (col.numeric_precision) {
        typeInfo += `(${col.numeric_precision},${col.numeric_scale || 0})`;
      }
      console.log(`  ${idx + 1}. ${col.column_name.padEnd(30)} ${typeInfo.padEnd(25)} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('');

    // 3. Foreign Key Relationships
    console.log('🔗 FOREIGN KEY RELATIONSHIPS');
    console.log('-'.repeat(80));
    
    // Journal Entries Foreign Keys
    const journalEntriesFKs = await sequelize.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'journal_entries'
    `, { type: QueryTypes.SELECT });

    console.log('Journal Entries Foreign Keys:');
    journalEntriesFKs.forEach((fk, idx) => {
      console.log(`  ${idx + 1}. ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
    });
    console.log('');

    // Journal Entry Lines Foreign Keys
    const journalEntryLinesFKs = await sequelize.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'journal_entry_lines'
    `, { type: QueryTypes.SELECT });

    console.log('Journal Entry Lines Foreign Keys:');
    journalEntryLinesFKs.forEach((fk, idx) => {
      console.log(`  ${idx + 1}. ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
    });
    console.log('');

    // 4. Sample Data Structure (if any exists)
    console.log('📄 SAMPLE DATA STRUCTURE');
    console.log('-'.repeat(80));
    
    const sampleEntry = await sequelize.query(`
      SELECT * FROM journal_entries LIMIT 1
    `, { type: QueryTypes.SELECT });

    if (sampleEntry.length > 0) {
      console.log('Sample Journal Entry:');
      console.log(JSON.stringify(sampleEntry[0], null, 2));
      console.log('');
    } else {
      console.log('No journal entries found. Showing expected structure based on schema...');
      console.log('');
      const expectedStructure = {
        id: 'uuid',
        reference_number: 'string(100)',
        entry_date: 'date',
        description: 'text (nullable)',
        financial_year_id: 'uuid',
        total_debit: 'decimal(15,2)',
        total_credit: 'decimal(15,2)',
        is_posted: 'boolean',
        posted_at: 'timestamp (nullable)',
        posted_by: 'uuid (nullable)',
        created_by: 'uuid (nullable)',
        updated_by: 'uuid (nullable)',
        companyId: 'uuid',
        created_at: 'timestamp',
        updated_at: 'timestamp'
      };
      console.log(JSON.stringify(expectedStructure, null, 2));
      console.log('');
    }

    const sampleLine = await sequelize.query(`
      SELECT * FROM journal_entry_lines LIMIT 1
    `, { type: QueryTypes.SELECT });

    if (sampleLine.length > 0) {
      console.log('Sample Journal Entry Line:');
      console.log(JSON.stringify(sampleLine[0], null, 2));
    } else {
      console.log('No journal entry lines found. Showing expected structure based on schema...');
      const expectedLineStructure = {
        id: 'uuid',
        journal_entry_id: 'uuid',
        account_id: 'uuid',
        account_type_id: 'uuid (nullable)',
        type: 'enum(debit, credit)',
        amount: 'decimal(15,2)',
        original_amount: 'decimal(15,2) (nullable)',
        equivalent_amount: 'decimal(24,4) (nullable)',
        currency_id: 'uuid (nullable)',
        exchange_rate_id: 'uuid (nullable)',
        exchange_rate: 'decimal(15,6) (nullable)',
        description: 'text (nullable)',
        line_number: 'integer',
        companyId: 'uuid',
        created_at: 'timestamp',
        updated_at: 'timestamp'
      };
      console.log(JSON.stringify(expectedLineStructure, null, 2));
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Schema reading completed successfully');
    console.log('='.repeat(80));

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await sequelize.close();
    process.exit(1);
  }
}

// Run the script
readJournalEntrySchema();

