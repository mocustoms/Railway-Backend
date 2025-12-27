'use strict';

/**
 * Fix Customers Unique Constraints for Multi-Tenant Support
 * 
 * This migration fixes unique constraints for customers:
 * 1. customers.customer_id - should be unique per company, not globally
 * 2. customers.full_name - should be unique per company (NEW)
 * 
 * For each field:
 * - Drops old global unique constraints/indexes
 * - Ensures composite unique index with companyId is in place
 * 
 * This allows different companies to have the same customer codes and names.
 */

const TABLES_TO_FIX = [
  {
    tableName: 'customers',
    fieldName: 'customer_id',
    indexName: 'customers_customer_id_companyId_unique'
  },
  {
    tableName: 'customers',
    fieldName: 'full_name',
    indexName: 'customers_full_name_companyId_unique'
  }
];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Fixing customers unique constraints for multi-tenant support...\n');

      for (const table of TABLES_TO_FIX) {
        console.log(`\n📋 Processing ${table.tableName}.${table.fieldName}...`);

        // Get all existing unique constraints on the field
        const constraints = await queryInterface.sequelize.query(
          `SELECT constraint_name 
           FROM information_schema.table_constraints
           WHERE table_name = '${table.tableName}'
             AND constraint_type = 'UNIQUE'
             AND constraint_name LIKE '%${table.fieldName.replace(/_/g, '%')}%'
             AND constraint_name NOT LIKE '%companyId%'
             AND constraint_name NOT LIKE '%company_id%'
             AND constraint_name NOT LIKE '%pkey%'
           ORDER BY constraint_name;`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );

        // Get all existing unique indexes on the field
        const indexes = await queryInterface.sequelize.query(
          `SELECT indexname 
           FROM pg_indexes
           WHERE tablename = '${table.tableName}'
             AND indexname LIKE '%${table.fieldName.replace(/_/g, '%')}%'
             AND indexname NOT LIKE '%companyId%'
             AND indexname NOT LIKE '%company_id%'
             AND indexname NOT LIKE '%pkey%'
             AND indexdef LIKE '%UNIQUE%'
           ORDER BY indexname;`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );

        // Combine constraints and indexes (some constraints create indexes with same name)
        const allToDrop = new Set();
        constraints.forEach(c => allToDrop.add(c.constraint_name));
        indexes.forEach(idx => allToDrop.add(idx.indexname));

        // Drop global unique constraints/indexes
        for (const name of allToDrop) {
          try {
            // Use SAVEPOINT to handle errors gracefully
            await queryInterface.sequelize.query('SAVEPOINT before_drop_constraint;', { transaction });
            
            // Try dropping as index first (indexes are more common)
            try {
              await queryInterface.sequelize.query(
                `DROP INDEX IF EXISTS "${name}" CASCADE;`,
                { transaction }
              );
              console.log(`  ✅ Dropped index: ${name}`);
            } catch (indexError) {
              // If it's not an index, try dropping as constraint
              try {
                await queryInterface.sequelize.query(
                  `ALTER TABLE ${table.tableName} DROP CONSTRAINT IF EXISTS "${name}" CASCADE;`,
                  { transaction }
                );
                console.log(`  ✅ Dropped constraint: ${name}`);
              } catch (constraintError) {
                // Both failed - check if it's a "does not exist" error
                if (constraintError.message && constraintError.message.includes('does not exist')) {
                  console.log(`  ℹ️  ${name} does not exist, skipping...`);
                } else {
                  throw constraintError;
                }
              }
            }
            
            await queryInterface.sequelize.query('RELEASE SAVEPOINT before_drop_constraint;', { transaction });
          } catch (error) {
            await queryInterface.sequelize.query('ROLLBACK TO SAVEPOINT before_drop_constraint;', { transaction });
            
            // Check if it's a "does not exist" error - that's okay
            if (error.message && error.message.includes('does not exist')) {
              console.log(`  ℹ️  ${name} does not exist, skipping...`);
            } else {
              console.warn(`  ⚠️  Could not drop ${name}: ${error.message}`);
            }
          }
        }

        if (allToDrop.size === 0) {
          console.log(`  ✅ No global unique constraints/indexes found for ${table.fieldName}`);
        }

        // Check for duplicates before creating unique index
        const fieldNameQuoted = `"${table.fieldName}"`;
        const duplicates = await queryInterface.sequelize.query(
          `SELECT ${fieldNameQuoted}, "companyId", COUNT(*) as count
           FROM ${table.tableName}
           WHERE ${fieldNameQuoted} IS NOT NULL
           GROUP BY ${fieldNameQuoted}, "companyId"
           HAVING COUNT(*) > 1
           LIMIT 5;`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );

        if (duplicates.length > 0) {
          console.warn(`  ⚠️  WARNING: Found ${duplicates.length} duplicate(s) in ${table.tableName}`);
          console.warn(`     Cannot create unique index until duplicates are resolved.`);
          console.warn(`     Example duplicate: ${table.fieldName}="${duplicates[0][table.fieldName]}", companyId="${duplicates[0].companyId}" (appears ${duplicates[0].count} times)`);
          console.warn(`     Please clean up duplicates before running this migration again.`);
        } else {
          // Ensure composite unique index exists
          const indexExists = await queryInterface.sequelize.query(
            `SELECT 1 
             FROM pg_indexes 
             WHERE tablename = '${table.tableName}' 
               AND indexname = '${table.indexName}';`,
            { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
          );

          if (indexExists.length === 0) {
            console.log(`  Creating composite unique index: ${table.indexName}`);
            
            await queryInterface.addIndex(table.tableName, [table.fieldName, 'companyId'], {
              unique: true,
              name: table.indexName,
              transaction
            });
            console.log(`  ✅ Created composite unique index: ${table.indexName}`);
          } else {
            console.log(`  ✅ Composite unique index ${table.indexName} already exists`);
          }
        }
      }

      await transaction.commit();
      console.log('\n✅ Successfully fixed customers unique constraints for multi-tenant support\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error fixing customers unique constraints:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Note: We don't restore global unique constraints in down migration
    // as they would break multi-tenant functionality
    console.log('⚠️  Down migration not implemented - global unique constraints would break multi-tenant support');
  }
};

