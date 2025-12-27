'use strict';

/**
 * Fix Product Categories Unique Constraints for Multi-Tenant Support
 * 
 * This migration fixes unique constraints for product categories:
 * 1. product_categories.code - should be unique per company, not globally
 * 
 * For the field:
 * - Drops old global unique constraints/indexes
 * - Ensures composite unique index with companyId is in place
 * 
 * This allows different companies to have the same product category codes.
 */

const TABLES_TO_FIX = [
  {
    tableName: 'product_categories',
    fieldName: 'code',
    indexName: 'product_categories_code_companyId_unique'
  }
];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Fixing product categories unique constraints for multi-tenant support...\n');

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
            await queryInterface.sequelize.query('SAVEPOINT before_drop_constraint;', { transaction });
            
            try {
              await queryInterface.sequelize.query(
                `DROP INDEX IF EXISTS ${name} CASCADE;`,
                { transaction }
              );
              console.log(`  ✅ Dropped index: ${name}`);
            } catch (indexError) {
              try {
                await queryInterface.sequelize.query(
                  `ALTER TABLE ${table.tableName} DROP CONSTRAINT IF EXISTS ${name} CASCADE;`,
                  { transaction }
                );
                console.log(`  ✅ Dropped constraint: ${name}`);
              } catch (constraintError) {
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
            if (error.message && error.message.includes('does not exist')) {
              console.log(`  ℹ️  ${name} does not exist, skipping...`);
            } else {
              console.warn(`  ⚠️  Could not drop ${name}: ${error.message}`);
            }
          }
        }

        if (allToDrop.size === 0) {
          console.log(`  ℹ️  No global unique constraints/indexes found for ${table.fieldName}`);
        }

        // Check for duplicate data before creating unique index
        const fieldNameQuoted = `"${table.fieldName}"`;
        const duplicates = await queryInterface.sequelize.query(
          `SELECT ${fieldNameQuoted}, "companyId", COUNT(*) as count
           FROM ${table.tableName}
           WHERE ${fieldNameQuoted} IS NOT NULL
           GROUP BY ${fieldNameQuoted}, "companyId"
           HAVING COUNT(*) > 1;`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );

        if (duplicates.length > 0) {
          console.warn(`  ⚠️  Found ${duplicates.length} duplicate ${table.fieldName} values per company:`);
          duplicates.forEach(dup => {
            console.warn(`     - ${table.fieldName}: "${dup[table.fieldName]}", companyId: ${dup.companyId}, count: ${dup.count}`);
          });
          console.warn(`  ⚠️  Cannot create unique index until duplicates are resolved.`);
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
      console.log('\n✅ Successfully fixed product categories unique constraints for multi-tenant support\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error fixing product categories unique constraints:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Note: We don't restore global unique constraints in down migration
    // as they would break multi-tenant functionality
    console.log('⚠️  Down migration not implemented - global unique constraints would break multi-tenant support');
  }
};

