#!/usr/bin/env node

/**
 * Generate Complete Database Migration
 * 
 * Creates a single migration file that represents the complete current database schema
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const sequelize = require('../config/database');
const fs = require('fs');
const path = require('path');

async function getEnums(sequelize) {
  const enums = await sequelize.query(`
    SELECT 
      t.typname as enum_name,
      string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as enum_values
    FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid  
    WHERE t.typname NOT LIKE 'pg_%'
      AND t.typname NOT LIKE 'information_schema%'
    GROUP BY t.typname
    ORDER BY t.typname;
  `, {
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(enums) ? enums : [];
}

async function getTables(sequelize) {
  const tables = await sequelize.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name != 'SequelizeMeta'
    ORDER BY table_name;
  `, {
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(tables) ? tables : [];
}

async function getTableColumns(sequelize, tableName) {
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
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(columns) ? columns : [];
}

async function getTableConstraints(sequelize, tableName) {
  const constraints = await sequelize.query(`
    SELECT 
      tc.constraint_name,
      tc.constraint_type,
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    LEFT JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = :tableName
    GROUP BY tc.constraint_name, tc.constraint_type, ccu.table_name, ccu.column_name, rc.update_rule, rc.delete_rule
    ORDER BY tc.constraint_type, tc.constraint_name;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(constraints) ? constraints : [];
}

async function getTableIndexes(sequelize, tableName) {
  const indexes = await sequelize.query(`
    SELECT
      i.indexname,
      i.indexdef,
      idx.indisunique as is_unique,
      idx.indisprimary as is_primary
    FROM pg_indexes i
    JOIN pg_index idx ON i.indexname = (
      SELECT relname FROM pg_class WHERE oid = idx.indexrelid
    )
    WHERE i.schemaname = 'public' 
      AND i.tablename = :tableName
      AND NOT idx.indisprimary
    ORDER BY i.indexname;
  `, {
    replacements: { tableName },
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(indexes) ? indexes : [];
}

async function getSequences(sequelize) {
  const sequences = await sequelize.query(`
    SELECT 
      sequence_name,
      data_type,
      numeric_precision,
      numeric_scale,
      start_value,
      minimum_value,
      maximum_value,
      increment
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
    ORDER BY sequence_name;
  `, {
    type: sequelize.QueryTypes.SELECT
  });
  
  return Array.isArray(sequences) ? sequences : [];
}

function formatColumnType(col) {
  let type = col.udt_name;
  
  // Handle special types
  if (col.udt_name === 'varchar' || col.udt_name === 'char') {
    if (col.character_maximum_length) {
      type = `${col.udt_name}(${col.character_maximum_length})`;
    } else {
      type = col.udt_name === 'varchar' ? 'text' : 'char';
    }
  } else if (col.udt_name === 'numeric' || col.udt_name === 'decimal') {
    if (col.numeric_precision !== null) {
      type = `${col.udt_name}(${col.numeric_precision}`;
      if (col.numeric_scale !== null) {
        type += `,${col.numeric_scale}`;
      }
      type += ')';
    }
  } else if (col.udt_name.startsWith('enum_')) {
    type = col.udt_name;
  } else if (col.udt_name === 'timestamptz') {
    type = 'timestamp with time zone';
  } else if (col.udt_name === 'timestamp') {
    type = 'timestamp without time zone';
  }
  
  return type;
}

function formatDefault(defaultValue) {
  if (!defaultValue) return null;
  
  // Remove ::type casts for readability
  let def = defaultValue.toString();
  
  // Handle nextval sequences
  if (def.includes('nextval')) {
    return def;
  }
  
  // Handle boolean defaults
  if (def === 'true' || def === 'false') {
    return def;
  }
  
  // Handle UUID defaults
  if (def.includes('gen_random_uuid') || def.includes('uuid_generate')) {
    return def;
  }
  
  // Handle NOW() and CURRENT_TIMESTAMP
  if (def.includes('now()') || def.includes('CURRENT_TIMESTAMP')) {
    return def;
  }
  
  // Handle string defaults - keep quotes
  if (def.startsWith("'") && def.endsWith("'")) {
    return def;
  }
  
  return def;
}

async function generateMigration() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log('🔄 Generating complete migration file...\n');
    
    const migrationContent = [];
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '');
    const migrationName = `${timestamp}-complete-database-schema.js`;
    
    // Header
    migrationContent.push("'use strict';");
    migrationContent.push("");
    migrationContent.push("/**");
    migrationContent.push(" * Complete Database Schema Migration");
    migrationContent.push(" * ");
    migrationContent.push(" * This migration represents the complete current state of the database.");
    migrationContent.push(" * Generated automatically from the current database schema.");
    migrationContent.push(" * ");
    migrationContent.push(" * Includes:");
    migrationContent.push(" * - All enum types");
    migrationContent.push(" * - All tables with columns, constraints, and indexes");
    migrationContent.push(" * - All sequences");
    migrationContent.push(" */");
    migrationContent.push("");
    migrationContent.push("module.exports = {");
    migrationContent.push("  up: async (queryInterface, Sequelize) => {");
    migrationContent.push("    const transaction = await queryInterface.sequelize.transaction();");
    migrationContent.push("    ");
    migrationContent.push("    try {");
    migrationContent.push("      console.log('🔄 Creating complete database schema...\\n');");
    migrationContent.push("");
    
    // 1. Create Enums
    const enums = await getEnums(sequelize);
    migrationContent.push("      // ========================================");
    migrationContent.push("      // 1. CREATE ENUM TYPES");
    migrationContent.push("      // ========================================");
    migrationContent.push("      console.log('📝 Creating enum types...');");
    
    for (const enumType of enums) {
      // enum_values is a comma-separated string from string_agg
      const values = enumType.enum_values 
        ? enumType.enum_values.split(',').map(v => v.trim())
        : [];
      
      const valuesStr = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
      const enumVarName = `enumExists_${enumType.enum_name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      migrationContent.push(`      // Check if enum exists before creating`);
      migrationContent.push(`      const ${enumVarName} = await queryInterface.sequelize.query(`);
      migrationContent.push(`        \`SELECT 1 FROM pg_type WHERE typname = '${enumType.enum_name}'\`,`);
      migrationContent.push(`        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }`);
      migrationContent.push(`      );`);
      migrationContent.push(`      if (${enumVarName}.length === 0) {`);
      migrationContent.push(`        await queryInterface.sequelize.query(`);
      migrationContent.push(`          \`CREATE TYPE ${enumType.enum_name} AS ENUM (${valuesStr});\`,`);
      migrationContent.push(`          { transaction }`);
      migrationContent.push(`        );`);
      migrationContent.push(`      }`);
    }
    
    migrationContent.push(`      console.log('   ✅ Created ${enums.length} enum types\\n');`);
    migrationContent.push("");
    
    // 2. Create Tables
    const tables = await getTables(sequelize);
    migrationContent.push("      // ========================================");
    migrationContent.push("      // 2. CREATE TABLES");
    migrationContent.push("      // ========================================");
    migrationContent.push("      console.log('📊 Creating tables...');");
    
    for (const table of tables) {
      const columns = await getTableColumns(sequelize, table.table_name);
      const constraints = await getTableConstraints(sequelize, table.table_name);
      const indexes = await getTableIndexes(sequelize, table.table_name);
      
      migrationContent.push("");
      migrationContent.push(`      // Table: ${table.table_name}`);
      migrationContent.push(`      const tableExists_${table.table_name.replace(/[^a-zA-Z0-9]/g, '_')} = await queryInterface.sequelize.query(`);
      migrationContent.push(`        \`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table.table_name}'\`,`);
      migrationContent.push(`        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }`);
      migrationContent.push(`      );`);
      migrationContent.push(`      if (tableExists_${table.table_name.replace(/[^a-zA-Z0-9]/g, '_')}.length === 0) {`);
      migrationContent.push(`        await queryInterface.createTable('${table.table_name}', {`);
      
      // Add columns
      for (const col of columns) {
        const colType = formatColumnType(col);
        const nullable = col.is_nullable === 'YES' ? 'true' : 'false';
        const defaultValue = formatDefault(col.column_default);
        
        let colDef = `        ${col.column_name}: {`;
        const sequelizeType = getSequelizeType(col.udt_name, col);
        
        // Handle enum types
        if (col.udt_name.startsWith('enum_')) {
          // Get enum values for this enum type
          const enumType = enums.find(e => e.enum_name === col.udt_name);
          if (enumType) {
            const enumValues = enumType.enum_values 
              ? enumType.enum_values.split(',').map(v => v.trim())
              : [];
            const enumValuesStr = enumValues.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
            colDef += `\n          type: Sequelize.DataTypes.ENUM(${enumValuesStr})`;
          } else {
            colDef += `\n          type: Sequelize.DataTypes.STRING`;
          }
        } else if (col.character_maximum_length && (col.udt_name === 'varchar' || col.udt_name === 'char')) {
          colDef += `\n          type: Sequelize.DataTypes.${sequelizeType}(${col.character_maximum_length})`;
        } else if (col.numeric_precision !== null && (col.udt_name === 'numeric' || col.udt_name === 'decimal')) {
          colDef += `\n          type: Sequelize.DataTypes.${sequelizeType}(${col.numeric_precision}`;
          if (col.numeric_scale !== null) {
            colDef += `, ${col.numeric_scale}`;
          }
          colDef += ')';
        } else {
          colDef += `\n          type: Sequelize.DataTypes.${sequelizeType}`;
        }
        
        colDef += `,`;
        colDef += `\n          allowNull: ${nullable}`;
        
        if (defaultValue) {
          if (defaultValue.includes('nextval') || defaultValue.includes('gen_random_uuid')) {
            colDef += `,`;
            // Escape single quotes in the literal
            const escapedValue = defaultValue.replace(/'/g, "\\'");
            colDef += `\n          defaultValue: Sequelize.literal(\`${escapedValue}\`)`;
          } else if (defaultValue === 'true' || defaultValue === 'false') {
            colDef += `,`;
            colDef += `\n          defaultValue: ${defaultValue}`;
          } else if (defaultValue.includes('now()') || defaultValue.includes('CURRENT_TIMESTAMP')) {
            colDef += `,`;
            const escapedValue = defaultValue.replace(/'/g, "\\'");
            colDef += `\n          defaultValue: Sequelize.literal(\`${escapedValue}\`)`;
          } else {
            colDef += `,`;
            colDef += `\n          defaultValue: '${defaultValue.replace(/'/g, "\\'")}'`;
          }
        }
        
        // Handle field name for camelCase columns
        if (col.column_name !== col.column_name.toLowerCase()) {
          colDef += `,`;
          colDef += `\n          field: '${col.column_name}'`;
        }
        
        colDef += `\n        },`;
        migrationContent.push(colDef);
      }
      
      migrationContent.push("      }, { transaction });");
      migrationContent.push(`      }`);
      migrationContent.push("");
      
      // Add foreign keys (after table creation)
      const foreignKeys = constraints.filter(c => c.constraint_type === 'FOREIGN KEY');
      let fkCounter = 0;
      for (const fk of foreignKeys) {
        const columns = fk.columns.split(', ');
        const onDelete = fk.delete_rule || 'RESTRICT';
        const onUpdate = fk.update_rule || 'CASCADE';
        const tablePrefix = table.table_name.replace(/[^a-zA-Z0-9]/g, '_');
        const fkVarName = `fkExists_${tablePrefix}_${fkCounter}_${fk.constraint_name.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}`;
        fkCounter++;
        
        migrationContent.push(`      // Check if foreign key exists`);
        migrationContent.push(`      const ${fkVarName} = await queryInterface.sequelize.query(`);
        migrationContent.push(`        \`SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND constraint_name = '${fk.constraint_name}'\`,`);
        migrationContent.push(`        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }`);
        migrationContent.push(`      );`);
        migrationContent.push(`      if (${fkVarName}.length === 0) {`);
        migrationContent.push(`        const savepoint_${fkVarName} = 'sp_${fkVarName}';`);
        migrationContent.push(`        await queryInterface.sequelize.query(\`SAVEPOINT \${savepoint_${fkVarName}}\`, { transaction });`);
        migrationContent.push(`        try {`);
        migrationContent.push(`          await queryInterface.addConstraint('${table.table_name}', {`);
        migrationContent.push(`            fields: [${columns.map(c => `'${c}'`).join(', ')}],`);
        migrationContent.push(`            type: 'foreign key',`);
        migrationContent.push(`            name: '${fk.constraint_name}',`);
        migrationContent.push(`            references: {`);
        migrationContent.push(`              table: '${fk.foreign_table_name}',`);
        migrationContent.push(`              field: '${fk.foreign_column_name}'`);
        migrationContent.push(`            },`);
        migrationContent.push(`            onDelete: '${onDelete}',`);
        migrationContent.push(`            onUpdate: '${onUpdate}',`);
        migrationContent.push(`            transaction`);
        migrationContent.push(`          });`);
        migrationContent.push(`          await queryInterface.sequelize.query(\`RELEASE SAVEPOINT \${savepoint_${fkVarName}}\`, { transaction });`);
        migrationContent.push(`        } catch (fkError) {`);
        migrationContent.push(`          await queryInterface.sequelize.query(\`ROLLBACK TO SAVEPOINT \${savepoint_${fkVarName}}\`, { transaction });`);
        migrationContent.push(`          console.log(\`   ⚠️  Could not add FK ${fk.constraint_name}: \${fkError.message.substring(0, 100)}\`);`);
        migrationContent.push(`        }`);
        migrationContent.push(`      }`);
      }
      
      // Add unique constraints (that aren't primary keys)
      const uniqueConstraints = constraints.filter(c => 
        c.constraint_type === 'UNIQUE' && 
        !c.constraint_name.includes('_pkey')
      );
      let ucCounter = 0;
      for (const uc of uniqueConstraints) {
        const columns = uc.columns.split(', ');
        const tablePrefix = table.table_name.replace(/[^a-zA-Z0-9]/g, '_');
        const ucVarName = `ucExists_${tablePrefix}_${ucCounter}_${uc.constraint_name.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}`;
        ucCounter++;
        
        migrationContent.push(`      // Check if unique constraint exists`);
        migrationContent.push(`      const ${ucVarName} = await queryInterface.sequelize.query(`);
        migrationContent.push(`        \`SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND constraint_name = '${uc.constraint_name}'\`,`);
        migrationContent.push(`        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }`);
        migrationContent.push(`      );`);
        migrationContent.push(`      if (${ucVarName}.length === 0) {`);
        migrationContent.push(`        const savepoint_${ucVarName} = 'sp_${ucVarName}';`);
        migrationContent.push(`        await queryInterface.sequelize.query(\`SAVEPOINT \${savepoint_${ucVarName}}\`, { transaction });`);
        migrationContent.push(`        try {`);
        migrationContent.push(`          await queryInterface.addIndex('${table.table_name}', {`);
        migrationContent.push(`            fields: [${columns.map(c => `'${c}'`).join(', ')}],`);
        migrationContent.push(`            unique: true,`);
        migrationContent.push(`            name: '${uc.constraint_name}',`);
        migrationContent.push(`            transaction`);
        migrationContent.push(`          });`);
        migrationContent.push(`          await queryInterface.sequelize.query(\`RELEASE SAVEPOINT \${savepoint_${ucVarName}}\`, { transaction });`);
        migrationContent.push(`        } catch (ucError) {`);
        migrationContent.push(`          await queryInterface.sequelize.query(\`ROLLBACK TO SAVEPOINT \${savepoint_${ucVarName}}\`, { transaction });`);
        migrationContent.push(`          console.log(\`   ⚠️  Could not add UC ${uc.constraint_name}: \${ucError.message.substring(0, 100)}\`);`);
        migrationContent.push(`        }`);
        migrationContent.push(`      }`);
      }
      
      // Add other indexes
      let idxCounter = 0;
      for (const idx of indexes) {
        if (!idx.is_unique && !idx.is_primary) {
          // Extract column names from index definition
          const match = idx.indexdef.match(/ON.*USING.*\(([^)]+)\)/);
          if (match) {
            const columns = match[1].split(',').map(c => c.trim().replace(/"/g, ''));
            const tablePrefix = table.table_name.replace(/[^a-zA-Z0-9]/g, '_');
            const idxVarName = `idxExists_${tablePrefix}_${idxCounter}_${idx.indexname.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}`;
            idxCounter++;
            
            migrationContent.push(`      // Check if index exists`);
            migrationContent.push(`      const ${idxVarName} = await queryInterface.sequelize.query(`);
            migrationContent.push(`        \`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${idx.indexname}'\`,`);
            migrationContent.push(`        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }`);
            migrationContent.push(`      );`);
            migrationContent.push(`      if (${idxVarName}.length === 0) {`);
            migrationContent.push(`        const savepoint_${idxVarName} = 'sp_${idxVarName}';`);
            migrationContent.push(`        await queryInterface.sequelize.query(\`SAVEPOINT \${savepoint_${idxVarName}}\`, { transaction });`);
            migrationContent.push(`        try {`);
            migrationContent.push(`          await queryInterface.addIndex('${table.table_name}', {`);
            migrationContent.push(`            fields: [${columns.map(c => `'${c}'`).join(', ')}],`);
            migrationContent.push(`            name: '${idx.indexname}',`);
            migrationContent.push(`            transaction`);
            migrationContent.push(`          });`);
            migrationContent.push(`          await queryInterface.sequelize.query(\`RELEASE SAVEPOINT \${savepoint_${idxVarName}}\`, { transaction });`);
            migrationContent.push(`        } catch (idxError) {`);
            migrationContent.push(`          await queryInterface.sequelize.query(\`ROLLBACK TO SAVEPOINT \${savepoint_${idxVarName}}\`, { transaction });`);
            migrationContent.push(`          console.log(\`   ⚠️  Could not add index ${idx.indexname}: \${idxError.message.substring(0, 100)}\`);`);
            migrationContent.push(`        }`);
            migrationContent.push(`      }`);
          }
        }
      }
    }
    
    migrationContent.push(`      console.log('   ✅ Created ${tables.length} tables\\n');`);
    migrationContent.push("");
    
    // 3. Create Sequences
    const sequences = await getSequences(sequelize);
    if (sequences.length > 0) {
      migrationContent.push("      // ========================================");
      migrationContent.push("      // 3. CREATE SEQUENCES");
      migrationContent.push("      // ========================================");
      migrationContent.push("      console.log('🔢 Creating sequences...');");
      
      for (const seq of sequences) {
        migrationContent.push(`      await queryInterface.sequelize.query(`);
        migrationContent.push(`        \`CREATE SEQUENCE IF NOT EXISTS ${seq.sequence_name}`);
        migrationContent.push(`          START ${seq.start_value}`);
        migrationContent.push(`          INCREMENT ${seq.increment}`);
        migrationContent.push(`          MINVALUE ${seq.minimum_value}`);
        migrationContent.push(`          MAXVALUE ${seq.maximum_value};\`,`);
        migrationContent.push(`        { transaction }`);
        migrationContent.push(`      );`);
      }
      
      migrationContent.push(`      console.log('   ✅ Created ${sequences.length} sequences\\n');`);
      migrationContent.push("");
    }
    
    // Commit transaction
    migrationContent.push("      await transaction.commit();");
    migrationContent.push("      console.log('✅ Complete database schema created successfully!');");
    migrationContent.push("      console.log('='.repeat(60));");
    migrationContent.push("");
    migrationContent.push("    } catch (error) {");
    migrationContent.push("      await transaction.rollback();");
    migrationContent.push("      console.error('❌ Migration failed:', error.message);");
    migrationContent.push("      if (error.stack) {");
    migrationContent.push("        console.error('\\nStack:', error.stack.substring(0, 500));");
    migrationContent.push("      }");
    migrationContent.push("      throw error;");
    migrationContent.push("    }");
    migrationContent.push("  },");
    migrationContent.push("");
    migrationContent.push("  down: async (queryInterface, Sequelize) => {");
    migrationContent.push("    console.log('⚠️  Reverting complete database schema...');");
    migrationContent.push("    console.log('   This will drop all tables, enums, and sequences.');");
    migrationContent.push("    console.log('   Use with extreme caution!');");
    migrationContent.push("    ");
    migrationContent.push("    const transaction = await queryInterface.sequelize.transaction();");
    migrationContent.push("    ");
    migrationContent.push("    try {");
    migrationContent.push("      // Drop tables in reverse order");
    
    // Drop tables in reverse
    for (let i = tables.length - 1; i >= 0; i--) {
      migrationContent.push(`      await queryInterface.dropTable('${tables[i].table_name}', { transaction, cascade: true });`);
    }
    
    // Drop enums
    migrationContent.push("      ");
    migrationContent.push("      // Drop enum types");
    for (let i = enums.length - 1; i >= 0; i--) {
      migrationContent.push(`      await queryInterface.sequelize.query(\`DROP TYPE IF EXISTS ${enums[i].enum_name} CASCADE;\`, { transaction });`);
    }
    
    // Drop sequences
    if (sequences.length > 0) {
      migrationContent.push("      ");
      migrationContent.push("      // Drop sequences");
      for (const seq of sequences) {
        migrationContent.push(`      await queryInterface.sequelize.query(\`DROP SEQUENCE IF EXISTS ${seq.sequence_name} CASCADE;\`, { transaction });`);
      }
    }
    
    migrationContent.push("      ");
    migrationContent.push("      await transaction.commit();");
    migrationContent.push("      console.log('✅ Schema reverted successfully');");
    migrationContent.push("    } catch (error) {");
    migrationContent.push("      await transaction.rollback();");
    migrationContent.push("      console.error('❌ Revert failed:', error.message);");
    migrationContent.push("      throw error;");
    migrationContent.push("    }");
    migrationContent.push("  }");
    migrationContent.push("};");
    
    // Write migration file
    const migrationPath = path.join(__dirname, '../migrations', migrationName);
    fs.writeFileSync(migrationPath, migrationContent.join('\n'));
    
    console.log(`✅ Migration file created: ${migrationName}`);
    console.log(`   Location: ${migrationPath}`);
    console.log(`   Size: ${(migrationContent.join('\n').length / 1024).toFixed(2)} KB`);
    console.log('');
    
    return migrationName;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    throw error;
  } finally {
    await sequelize.close();
  }
}

function getSequelizeType(udtName, col) {
  // Map PostgreSQL types to Sequelize types
  const typeMap = {
    'uuid': 'UUID',
    'varchar': 'STRING',
    'char': 'CHAR',
    'text': 'TEXT',
    'integer': 'INTEGER',
    'int4': 'INTEGER',
    'bigint': 'BIGINT',
    'int8': 'BIGINT',
    'smallint': 'INTEGER',
    'int2': 'INTEGER',
    'decimal': 'DECIMAL',
    'numeric': 'DECIMAL',
    'real': 'REAL',
    'float4': 'REAL',
    'double precision': 'DOUBLE',
    'float8': 'DOUBLE',
    'boolean': 'BOOLEAN',
    'bool': 'BOOLEAN',
    'date': 'DATEONLY',
    'timestamp': 'DATE',
    'timestamptz': 'DATE',
    'time': 'TIME',
    'json': 'JSON',
    'jsonb': 'JSONB',
    'array': 'ARRAY'
  };
  
  if (udtName.startsWith('enum_')) {
    return 'ENUM';
  }
  
  return typeMap[udtName] || 'STRING';
}

// Run
generateMigration().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

