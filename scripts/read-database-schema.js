const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'easymauzo_pos',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

const tables = [
  'general_ledger',
  'customers',
  'loyalty_transactions',
  'price_history',
  'product_expiry_dates',
  'product_serial_numbers',
  'product_transactions',
  'sales_transactions'
];

async function getTableSchema(tableName) {
  try {
    const query = `
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        is_nullable,
        column_default,
        udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = :tableName
      ORDER BY ordinal_position;
    `;

    const columns = await sequelize.query(query, {
      replacements: { tableName },
      type: Sequelize.QueryTypes.SELECT
    });

    return columns;
  } catch (error) {
    console.error(`Error reading table ${tableName}:`, error.message);
    return [];
  }
}

async function getTableConstraints(tableName) {
  try {
    const query = `
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
    `;

    const constraints = await sequelize.query(query, {
      replacements: { tableName },
      type: Sequelize.QueryTypes.SELECT
    });

    return constraints;
  } catch (error) {
    console.error(`Error reading constraints for ${tableName}:`, error.message);
    return [];
  }
}

async function getTableIndexes(tableName) {
  try {
    const query = `
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = :tableName
      ORDER BY indexname;
    `;

    const indexes = await sequelize.query(query, {
      replacements: { tableName },
      type: Sequelize.QueryTypes.SELECT
    });

    return indexes;
  } catch (error) {
    console.error(`Error reading indexes for ${tableName}:`, error.message);
    return [];
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    const results = {};

    for (const tableName of tables) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 TABLE: ${tableName.toUpperCase()}`);
      console.log('='.repeat(80));

      // Check if table exists
      const tableExists = await sequelize.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = '${tableName}'
        );
      `, { type: Sequelize.QueryTypes.SELECT });

      if (!tableExists[0].exists) {
        console.log(`⚠️  Table ${tableName} does not exist in the database`);
        results[tableName] = { exists: false };
        continue;
      }

      const columns = await getTableSchema(tableName);
      const constraints = await getTableConstraints(tableName);
      const indexes = await getTableIndexes(tableName);

      results[tableName] = {
        exists: true,
        columns,
        constraints,
        indexes
      };

      console.log(`\n📋 COLUMNS (${columns.length}):`);
      console.log('-'.repeat(80));
      columns.forEach((col, idx) => {
        let typeInfo = col.data_type;
        if (col.character_maximum_length) {
          typeInfo += `(${col.character_maximum_length})`;
        } else if (col.numeric_precision && col.numeric_scale) {
          typeInfo += `(${col.numeric_precision},${col.numeric_scale})`;
        } else if (col.numeric_precision) {
          typeInfo += `(${col.numeric_precision})`;
        }
        if (col.udt_name && col.udt_name !== col.data_type) {
          typeInfo += ` [${col.udt_name}]`;
        }
        
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        
        console.log(`${(idx + 1).toString().padStart(3)}. ${col.column_name.padEnd(40)} ${typeInfo.padEnd(25)} ${nullable}${defaultVal}`);
      });

      if (constraints.length > 0) {
        console.log(`\n🔗 CONSTRAINTS (${constraints.length}):`);
        console.log('-'.repeat(80));
        constraints.forEach((constraint, idx) => {
          let constraintInfo = `${constraint.constraint_type}: ${constraint.constraint_name}`;
          if (constraint.constraint_type === 'FOREIGN KEY') {
            constraintInfo += ` (${constraint.column_name} → ${constraint.foreign_table_name}.${constraint.foreign_column_name})`;
          } else if (constraint.constraint_type === 'UNIQUE' || constraint.constraint_type === 'PRIMARY KEY') {
            constraintInfo += ` (${constraint.column_name})`;
          }
          console.log(`${(idx + 1).toString().padStart(3)}. ${constraintInfo}`);
        });
      }

      if (indexes.length > 0) {
        console.log(`\n📑 INDEXES (${indexes.length}):`);
        console.log('-'.repeat(80));
        indexes.forEach((index, idx) => {
          console.log(`${(idx + 1).toString().padStart(3)}. ${index.indexname}`);
        });
      }
    }

    // Save detailed results to JSON file
    const fs = require('fs');
    const path = require('path');
    const outputPath = path.join(__dirname, '../DATABASE_SCHEMA_ACTUAL.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n\n✅ Detailed schema saved to: ${outputPath}`);

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
