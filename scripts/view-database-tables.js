#!/usr/bin/env node

/**
 * Database Table Viewer Script
 * Allows you to directly view tables in the database
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
  logging: false
});

async function viewTables() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database:', config.DB_NAME);
    console.log('📍 Host:', config.DB_HOST + ':' + config.DB_PORT);
    console.log('👤 User:', config.DB_USER);
    console.log('\n');

    // Get all tables
    const tables = await sequelize.query(`
      SELECT 
        table_name,
        table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `, { type: QueryTypes.SELECT });

    console.log('📊 Available Tables (' + tables.length + '):');
    console.log('─'.repeat(60));
    tables.forEach((table, index) => {
      console.log(`${(index + 1).toString().padStart(3)}. ${table.table_name}`);
    });
    console.log('─'.repeat(60));
    console.log('\n');

    // Get command line arguments
    const args = process.argv.slice(2);
    
    if (args.length > 0) {
      const tableName = args[0];
      
      // Check if table exists
      const tableExists = tables.some(t => t.table_name === tableName);
      
      if (!tableExists) {
        console.error(`❌ Table "${tableName}" not found!`);
        console.log('\nAvailable tables:');
        tables.forEach(t => console.log(`  - ${t.table_name}`));
        process.exit(1);
      }

      // Get row count
      const countResult = await sequelize.query(
        `SELECT COUNT(*) as count FROM "${tableName}";`,
        { type: QueryTypes.SELECT }
      );
      const rowCount = countResult[0].count;

      console.log(`📋 Table: ${tableName}`);
      console.log(`📈 Total Rows: ${rowCount}`);
      console.log('─'.repeat(60));
      console.log('\n');

      // Get column information
      const columns = await sequelize.query(`
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_name = '${tableName}'
        ORDER BY ordinal_position;
      `, { type: QueryTypes.SELECT });

      console.log('🔍 Columns:');
      columns.forEach((col, index) => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const length = col.character_maximum_length ? `(${col.character_maximum_length})` : '';
        const defaultValue = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        console.log(`  ${(index + 1).toString().padStart(2)}. ${col.column_name.padEnd(30)} ${col.data_type.toUpperCase()}${length} ${nullable}${defaultValue}`);
      });
      console.log('\n');

      // Get sample data (first 10 rows)
      if (rowCount > 0) {
        console.log('📄 Sample Data (first 10 rows):');
        console.log('─'.repeat(60));
        
        const sampleData = await sequelize.query(
          `SELECT * FROM "${tableName}" LIMIT 10;`,
          { type: QueryTypes.SELECT }
        );

        if (sampleData.length > 0) {
          // Print column headers
          const headers = Object.keys(sampleData[0]);
          console.log(headers.join(' | '));
          console.log('─'.repeat(60));
          
          // Print data rows
          sampleData.forEach(row => {
            const values = headers.map(h => {
              const val = row[h];
              if (val === null || val === undefined) return 'NULL';
              if (typeof val === 'object') return JSON.stringify(val).substring(0, 50);
              return String(val).substring(0, 30);
            });
            console.log(values.join(' | '));
          });
        } else {
          console.log('(No data in table)');
        }
        console.log('─'.repeat(60));
        
        if (rowCount > 10) {
          console.log(`\n⚠️  Showing first 10 of ${rowCount} rows. Use SQL query to see more.`);
        }
      } else {
        console.log('📭 Table is empty (no rows)');
      }
    } else {
      console.log('💡 Usage:');
      console.log('  node view-database-tables.js                    # List all tables');
      console.log('  node view-database-tables.js <table_name>       # View table details');
      console.log('\n📝 Examples:');
      console.log('  node view-database-tables.js users');
      console.log('  node view-database-tables.js Company');
      console.log('  node view-database-tables.js customers');
      console.log('  node view-database-tables.js products');
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

viewTables();

