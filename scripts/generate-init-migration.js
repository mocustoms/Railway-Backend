const fs = require('fs');
const path = require('path');

// Read the database schema and ENUMs
const schemaPath = path.join(__dirname, '../database-schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const enumsPath = path.join(__dirname, '../database-enums.json');
let enums = {};
try {
    enums = JSON.parse(fs.readFileSync(enumsPath, 'utf8'));
} catch (e) {
    console.warn('Warning: Could not load ENUMs file, ENUMs will be treated as STRING');
}

// Define table creation order based on dependencies
const tableOrder = [
    // Core tables (no dependencies)
    'users',
    'currencies',
    'account_types',
    'transaction_types',
    'costing_methods',
    
    // Tables depending on users/currencies
    'accounts',
    'Company',
    'financial_years',
    'exchange_rates',
    'stores',
    'payment_methods',
    'tax_codes',
    'price_categories',
    'product_categories',
    'product_colors',
    'packaging',
    'product_brand_names',
    'product_manufacturers',
    'product_models',
    'product_store_locations',
    'adjustment_reasons',
    'return_reasons',
    'customer_groups',
    'loyalty_card_configs',
    'sales_agents',
    'price_change_reasons',
    
    // Many-to-many and junction tables
    'user_stores',
    
    // Tables depending on products
    'products',
    'product_price_categories',
    'product_stores',
    'product_pharmaceutical_info',
    'product_manufacturing_info',
    'product_raw_materials',
    'product_dosages',
    'product_serial_numbers',
    'product_expiry_dates',
    'product_transactions',
    
    // Tables depending on accounts
    'openingBalances',
    'payment_types',
    'bank_details',
    
    // Tables depending on stores/products/accounts
    'stock_adjustments',
    'stock_adjustment_items',
    'physical_inventories',
    'physical_inventory_items',
    'physical_inventory_reversals',
    'store_requests',
    'store_request_items',
    'store_request_item_transactions',
    
    // Customer related
    'customers',
    'customer_deposits',
    'loyalty_cards',
    'loyalty_card_configs',
    'loyalty_transactions',
    
    // Sales related
    'proforma_invoices',
    'proforma_invoice_items',
    
    // Financial
    'transactions',
    'general_ledger',
    'price_history',
    
    // Audit and system tables
    'account_type_audits',
    'auto_codes',
];

// Map column names to ENUM type names
function getEnumTypeForColumn(tableName, columnName) {
    const enumKey = `enum_${tableName}_${columnName}`;
    if (enums[enumKey]) {
        return enums[enumKey];
    }
    return null;
}

// Helper function to convert PostgreSQL data type to Sequelize
function convertDataType(column, tableName) {
    const { data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale } = column;
    
    // Check for ENUM first
    const enumValues = getEnumTypeForColumn(tableName, column.column_name);
    if (enumValues && enumValues.length > 0) {
        return `ENUM(${enumValues.map(v => `'${v}'`).join(', ')})`;
    }
    
    if (udt_name === 'uuid') {
        return 'UUID';
    }
    if (udt_name === 'int4' || udt_name === 'integer') return 'INTEGER';
    if (udt_name === 'int8' || udt_name === 'bigint') return 'BIGINT';
    if (udt_name === 'bool' || udt_name === 'boolean') return 'BOOLEAN';
    if (udt_name === 'text') return 'TEXT';
    if (udt_name === 'date') return 'DATEONLY';
    if (udt_name === 'timestamp' || udt_name === 'timestamptz') return 'DATE';
    if (udt_name === 'time') return 'TIME';
    if (udt_name === 'jsonb') return 'JSONB';
    if (udt_name === 'json') return 'JSON';
    
    if (udt_name === 'varchar' || udt_name === 'char') {
        if (character_maximum_length) {
            return `STRING(${character_maximum_length})`;
        }
        return 'STRING';
    }
    
    if (udt_name === 'numeric' || udt_name === 'decimal') {
        return `DECIMAL(${numeric_precision || 15}, ${numeric_scale || 2})`;
    }
    
    // Handle ENUM types (fallback)
    if (data_type === 'USER-DEFINED' && udt_name.includes('enum')) {
        return 'STRING'; // Will be handled as ENUM if found in enums map
    }
    
    return 'STRING';
}

// Helper to get column default
function getColumnDefault(column) {
    if (!column.column_default) return null;
    
    const def = column.column_default;
    
    // Handle UUID generation
    if (def.includes('uuid_generate_v4') || def.includes('uuid_generate_v4()')) {
        return 'Sequelize.UUIDV4';
    }
    
    // Handle sequences (auto-increment)
    if (def.includes('nextval')) {
        return null; // Let Sequelize handle auto-increment
    }
    
    // Handle boolean defaults
    if (def === 'true' || def === 'false') {
        return def === 'true';
    }
    
    // Handle string defaults (remove quotes and type casts)
    const stringMatch = def.match(/^'([^']*)'::/);
    if (stringMatch) {
        return stringMatch[1];
    }
    
    if (def.startsWith("'") && def.endsWith("'")) {
        return def.slice(1, -1).replace(/''/g, "'");
    }
    
    // Handle numeric defaults
    const numericMatch = def.match(/^(\d+\.?\d*)/);
    if (numericMatch) {
        const num = parseFloat(numericMatch[1]);
        if (!isNaN(num)) {
            return num;
        }
    }
    
    // Handle CURRENT_TIMESTAMP
    if (def.includes('CURRENT_TIMESTAMP') || def.includes('NOW()')) {
        return 'Sequelize.NOW';
    }
    
    return null;
}

// Check if column is auto-increment
function isAutoIncrement(column) {
    return column.column_default && column.column_default.includes('nextval');
}

// Generate migration file
function generateMigration() {
    let migrationCode = `'use strict';

/**
 * Comprehensive Database Initialization Migration
 * This migration creates all tables in the EasyMauzo POS system
 * Generated from actual database schema: ${new Date().toISOString()}
 * 
 * IMPORTANT: Review this migration before running on production!
 * - Test on a development database first
 * - Verify ENUM types match your requirements
 * - Check foreign key constraints
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Enable UUID extension if not already enabled
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    
`;

    // Track which ENUMs we've created
    const createdEnums = new Set();
    
    // Create tables in dependency order
    for (const tableName of tableOrder) {
        if (!schema[tableName]) {
            console.warn(`Warning: Table ${tableName} not found in schema, skipping...`);
            continue;
        }
        
        const tableSchema = schema[tableName];
        const columns = tableSchema.columns;
        const constraints = tableSchema.constraints;
        
        // Check for ENUMs that need to be created
        for (const column of columns) {
            if (column.data_type === 'USER-DEFINED' && column.udt_name.includes('enum')) {
                const enumKey = column.udt_name;
                if (!createdEnums.has(enumKey) && enums[enumKey]) {
                    const enumValues = enums[enumKey];
                    migrationCode += `\n    // Create ENUM type: ${enumKey}\n`;
                    migrationCode += `    await queryInterface.sequelize.query(\`CREATE TYPE ${enumKey} AS ENUM(${enumValues.map(v => `'${v}'`).join(', ')});\`);\n`;
                    createdEnums.add(enumKey);
                }
            }
        }
        
        migrationCode += `\n    // Create ${tableName} table\n`;
        migrationCode += `    await queryInterface.createTable('${tableName}', {\n`;
        
        // Check if table uses timestamps (has both created_at/createdAt and updated_at/updatedAt)
        const hasUnderscoreTimestamps = columns.some(c => c.column_name === 'created_at') && 
                                       columns.some(c => c.column_name === 'updated_at');
        const hasCamelTimestamps = columns.some(c => c.column_name === 'createdAt') && 
                                  columns.some(c => c.column_name === 'updatedAt');
        const usesTimestamps = hasUnderscoreTimestamps || hasCamelTimestamps;
        
        // Process columns
        for (const column of columns) {
            // Skip Sequelize auto-managed timestamps if they're the standard ones
            if (usesTimestamps && 
                (column.column_name === 'createdAt' || column.column_name === 'created_at' || 
                 column.column_name === 'updatedAt' || column.column_name === 'updated_at') &&
                (!column.column_default || column.column_default.includes('CURRENT_TIMESTAMP'))) {
                // These are handled by Sequelize timestamps option
                continue;
            }
            
            const type = convertDataType(column, tableName);
            const allowNull = column.is_nullable === 'YES';
            const defaultValue = getColumnDefault(column);
            const isAutoInc = isAutoIncrement(column);
            
            migrationCode += `      ${column.column_name}: {\n`;
            
            // Handle ENUM types specially
            if (type.startsWith('ENUM(')) {
                migrationCode += `        type: Sequelize.${type},\n`;
            } else {
                migrationCode += `        type: Sequelize.${type},\n`;
            }
            
            if (!allowNull) {
                migrationCode += `        allowNull: false,\n`;
            }
            
            // Handle auto-increment
            if (isAutoInc) {
                migrationCode += `        autoIncrement: true,\n`;
            }
            
            // Handle UUID default
            if (column.udt_name === 'uuid' && column.column_default && 
                column.column_default.includes('uuid_generate')) {
                migrationCode += `        defaultValue: Sequelize.UUIDV4,\n`;
            } else if (defaultValue !== null && !isAutoInc) {
                if (typeof defaultValue === 'string' && defaultValue.startsWith('Sequelize.')) {
                    migrationCode += `        defaultValue: ${defaultValue},\n`;
                } else if (typeof defaultValue === 'string') {
                    migrationCode += `        defaultValue: ${JSON.stringify(defaultValue)},\n`;
                } else {
                    migrationCode += `        defaultValue: ${JSON.stringify(defaultValue)},\n`;
                }
            }
            
            // Check if this is a primary key
            const isPrimaryKey = constraints.some(c => 
                c.constraint_type === 'PRIMARY KEY' && c.column_name === column.column_name
            );
            if (isPrimaryKey) {
                migrationCode += `        primaryKey: true,\n`;
            }
            
            // Check if this is unique
            const isUnique = constraints.some(c => 
                c.constraint_type === 'UNIQUE' && c.column_name === column.column_name
            );
            if (isUnique && !isPrimaryKey) {
                migrationCode += `        unique: true,\n`;
            }
            
            // Check for foreign key
            const foreignKey = constraints.find(c => 
                c.constraint_type === 'FOREIGN KEY' && 
                c.column_name === column.column_name &&
                c.foreign_table_name &&
                c.foreign_table_name !== tableName // Skip self-references for now
            );
            if (foreignKey) {
                migrationCode += `        references: {\n`;
                migrationCode += `          model: '${foreignKey.foreign_table_name}',\n`;
                migrationCode += `          key: '${foreignKey.foreign_column_name || 'id'}'\n`;
                migrationCode += `        },\n`;
                
                // Determine onDelete/onUpdate based on table patterns
                if (tableName.includes('_items') || tableName.includes('_transactions') || 
                    tableName.includes('_reversals') || tableName.includes('_audits')) {
                    migrationCode += `        onDelete: 'CASCADE',\n`;
                } else if (tableName.includes('user_stores') || tableName.includes('product_stores')) {
                    migrationCode += `        onDelete: 'CASCADE',\n`;
                } else {
                    migrationCode += `        onDelete: 'SET NULL',\n`;
                }
                migrationCode += `        onUpdate: 'CASCADE',\n`;
            }
            
            migrationCode += `      },\n`;
        }
        
        // Add timestamps option if table has timestamp columns
        if (usesTimestamps) {
            migrationCode += `    }, {\n`;
            migrationCode += `      timestamps: true,\n`;
            // Determine timestamp field names
            if (hasUnderscoreTimestamps) {
                migrationCode += `      createdAt: 'created_at',\n`;
                migrationCode += `      updatedAt: 'updated_at',\n`;
            }
            migrationCode += `    });\n`;
        } else {
            migrationCode += `    });\n`;
        }
        
        // Add indexes (skip primary key and unique constraints already defined)
        const indexesToAdd = [];
        for (const index of tableSchema.indexes) {
            if (index.indexname.includes('pkey') || 
                index.indexname.includes('_key') ||
                index.indexname.includes('_unique')) {
                continue; // Skip primary key and unique constraints
            }
            
            // Extract column names from index definition
            const match = index.indexdef.match(/ON.*?\(([^)]+)\)/);
            if (match) {
                const cols = match[1].split(',').map(c => {
                    // Remove quotes and extract column name
                    let col = c.trim().replace(/"/g, '');
                    // Handle expressions like "UPPER(column_name)"
                    const colMatch = col.match(/(\w+)$/);
                    if (colMatch) {
                        col = colMatch[1];
                    }
                    return col;
                }).filter(c => c && !c.includes('('));
                
                if (cols.length > 0) {
                    indexesToAdd.push({ name: index.indexname, columns: cols });
                }
            }
        }
        
        if (indexesToAdd.length > 0) {
            for (const idx of indexesToAdd) {
                migrationCode += `\n    // Add index: ${idx.name}\n`;
                migrationCode += `    await queryInterface.addIndex('${tableName}', [${idx.columns.map(c => `'${c}'`).join(', ')}]);\n`;
            }
        }
    }
    
    migrationCode += `\n  },\n\n`;
    migrationCode += `  down: async (queryInterface, Sequelize) => {\n`;
    migrationCode += `    // Drop tables in reverse order\n`;
    
    for (let i = tableOrder.length - 1; i >= 0; i--) {
        const tableName = tableOrder[i];
        if (schema[tableName]) {
            migrationCode += `    await queryInterface.dropTable('${tableName}');\n`;
        }
    }
    
    // Drop ENUM types (in reverse order they were created)
    const enumTypes = Array.from(createdEnums).reverse();
    if (enumTypes.length > 0) {
        migrationCode += `\n    // Drop ENUM types\n`;
        for (const enumType of enumTypes) {
            migrationCode += `    await queryInterface.sequelize.query(\`DROP TYPE IF EXISTS ${enumType};\`);\n`;
        }
    }
    
    migrationCode += `  }\n`;
    migrationCode += `};\n`;
    
    return migrationCode;
}

// Write migration file
const migrationCode = generateMigration();
const migrationPath = path.join(__dirname, '../migrations/00000000000000-initialize-database.js');

fs.writeFileSync(migrationPath, migrationCode);
console.log(`✅ Migration file generated: ${migrationPath}`);
console.log(`📊 Total tables: ${Object.keys(schema).length}`);
console.log(`📊 ENUM types found: ${Object.keys(enums).length}`);
console.log(`\n⚠️  IMPORTANT: Review and test this migration before running on production!`);
console.log(`   - Test on a development database first`);
console.log(`   - Verify ENUM types are correctly defined`);
console.log(`   - Check foreign key constraints match your needs`);
console.log(`   - Verify auto-increment sequences are correct`);
console.log(`   - Check timestamp fields are properly handled`);
