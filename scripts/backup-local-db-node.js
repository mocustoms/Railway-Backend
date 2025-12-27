#!/usr/bin/env node

/**
 * Backup Local Database (Node.js Version - No pg_dump required)
 * 
 * Creates a SQL dump using Sequelize and raw queries
 * Usage: node scripts/backup-local-db-node.js [output-file]
 */

require('dotenv').config();
const sequelize = require('../config/database');
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');

// Get database config
const config = require('../env');

// Output file
const outputFile = process.argv[2] || path.join(__dirname, `../backups/local-backup-${new Date().toISOString().split('T')[0]}.sql`);

// Ensure backups directory exists
const backupsDir = path.dirname(outputFile);
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

async function backupDatabase() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database');
    
    console.log('');
    console.log('📦 BACKING UP LOCAL DATABASE');
    console.log('='.repeat(80));
    console.log(`Database: ${config.DB_NAME || 'easymauzo_pos'}`);
    console.log(`Host: ${config.DB_HOST || 'localhost'}:${config.DB_PORT || 5432}`);
    console.log(`Output: ${outputFile}`);
    console.log('');
    
    const sqlStatements = [];
    sqlStatements.push('-- EasyMauzo Database Backup');
    sqlStatements.push(`-- Generated: ${new Date().toISOString()}`);
    sqlStatements.push(`-- Database: ${config.DB_NAME || 'easymauzo_pos'}`);
    sqlStatements.push('');
    sqlStatements.push('BEGIN;');
    sqlStatements.push('');
    
    // Get all table names
    console.log('🔄 Fetching table list...');
    const tables = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `, { type: QueryTypes.SELECT });
    
    console.log(`   Found ${tables.length} tables`);
    console.log('');
    
    // For each table, get structure and data
    for (let i = 0; i < tables.length; i++) {
      const tableName = tables[i].table_name;
      console.log(`📋 Processing table ${i + 1}/${tables.length}: ${tableName}`);
      
      // Get table structure (CREATE TABLE)
      const [createTable] = await sequelize.query(`
        SELECT 
          'CREATE TABLE IF NOT EXISTS ' || quote_ident(table_name) || ' (' ||
          string_agg(
            quote_ident(column_name) || ' ' || 
            CASE 
              WHEN data_type = 'USER-DEFINED' THEN udt_name
              WHEN data_type = 'ARRAY' THEN udt_name || '[]'
              ELSE data_type
            END ||
            CASE WHEN character_maximum_length IS NOT NULL 
              THEN '(' || character_maximum_length || ')' 
              ELSE '' 
            END ||
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN column_default IS NOT NULL 
              THEN ' DEFAULT ' || column_default 
              ELSE '' 
            END,
            ', '
          ) || ');' as create_statement
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = :tableName
        GROUP BY table_name;
      `, {
        replacements: { tableName },
        type: QueryTypes.SELECT
      });
      
      if (createTable && createTable.length > 0) {
        sqlStatements.push(`-- Table: ${tableName}`);
        sqlStatements.push(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);
        sqlStatements.push(createTable[0].create_statement);
        sqlStatements.push('');
      }
      
      // Get row count
      const [countResult] = await sequelize.query(
        `SELECT COUNT(*) as count FROM "${tableName}";`,
        { type: QueryTypes.SELECT }
      );
      const rowCount = parseInt(countResult.count);
      
      if (rowCount > 0) {
        console.log(`   📊 Exporting ${rowCount} rows...`);
        
        // Get all data
        const rows = await sequelize.query(
          `SELECT * FROM "${tableName}";`,
          { type: QueryTypes.SELECT }
        );
        
        if (rows.length > 0) {
          // Get column names
          const columns = Object.keys(rows[0]);
          
          // Generate INSERT statements in batches
          const batchSize = 100;
          for (let j = 0; j < rows.length; j += batchSize) {
            const batch = rows.slice(j, j + batchSize);
            const values = batch.map(row => {
              const vals = columns.map(col => {
                const val = row[col];
                if (val === null) return 'NULL';
                if (typeof val === 'string') {
                  return `'${val.replace(/'/g, "''")}'`;
                }
                if (val instanceof Date) {
                  return `'${val.toISOString()}'`;
                }
                if (typeof val === 'object') {
                  return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                }
                return val;
              });
              return `(${vals.join(', ')})`;
            });
            
            const columnList = columns.map(c => `"${c}"`).join(', ');
            sqlStatements.push(`INSERT INTO "${tableName}" (${columnList}) VALUES`);
            sqlStatements.push(values.join(',\n') + ';');
            sqlStatements.push('');
          }
        }
      } else {
        console.log('   ℹ️  Table is empty');
      }
    }
    
    sqlStatements.push('COMMIT;');
    sqlStatements.push('');
    sqlStatements.push('-- Backup completed successfully');
    
    // Write to file
    console.log('');
    console.log('💾 Writing backup file...');
    fs.writeFileSync(outputFile, sqlStatements.join('\n'), 'utf8');
    
    // Get file size
    const stats = fs.statSync(outputFile);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log('');
    console.log('✅ BACKUP COMPLETE!');
    console.log('='.repeat(80));
    console.log(`📁 File: ${outputFile}`);
    console.log(`📊 Size: ${fileSizeMB} MB`);
    console.log(`📋 Tables: ${tables.length}`);
    console.log('');
    console.log('💡 To restore this backup:');
    console.log(`   node scripts/restore-to-railway.js "${outputFile}"`);
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ BACKUP FAILED!');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    console.error('');
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

backupDatabase();

