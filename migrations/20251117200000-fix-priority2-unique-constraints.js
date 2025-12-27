'use strict';

/**
 * Fix Priority 2 Unique Constraints for Multi-Tenant Support
 * 
 * This migration fixes unique constraints for reference data:
 * 1. sales_agents.agent_number
 * 2. loyalty_cards.card_number
 * 3. loyalty_card_configs.config_name
 * 4. price_change_reasons.code
 * 5. price_categories.code
 * 
 * For each table:
 * - Drops old global unique constraints/indexes
 * - Ensures composite unique index with companyId is in place
 * 
 * This allows different companies to have the same values.
 */

const TABLES_TO_FIX = [
  {
    tableName: 'sales_agents',
    fieldName: 'agent_number',
    indexName: 'sales_agents_agent_number_companyId_unique'
  },
  {
    tableName: 'loyalty_cards',
    fieldName: 'card_number',
    indexName: 'loyalty_cards_card_number_companyId_unique'
  },
  {
    tableName: 'loyalty_card_configs',
    fieldName: 'config_name',
    indexName: 'loyalty_card_configs_config_name_companyId_unique'
  },
  {
    tableName: 'price_change_reasons',
    fieldName: 'code',
    indexName: 'price_change_reasons_code_companyId_unique'
  },
  {
    tableName: 'price_categories',
    fieldName: 'code',
    indexName: 'price_categories_code_companyId_unique'
  }
];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Fixing Priority 2 unique constraints for multi-tenant support...\n');

      for (const table of TABLES_TO_FIX) {
        console.log(`\n📋 Processing ${table.tableName}...`);

        // Check if table exists
        const tableExists = await queryInterface.sequelize.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = '${table.tableName}'
          );`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );

        if (!tableExists[0].exists) {
          console.log(`  ⚠️  Table ${table.tableName} does not exist, skipping...`);
          continue;
        }

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

        // Drop all old global unique constraints
        for (const constraint of constraints) {
          const constraintName = constraint.constraint_name;
          const savepointName = `sp_drop_constraint_${constraintName.replace(/[^a-zA-Z0-9]/g, '_')}`;
          try {
            await queryInterface.sequelize.query(`SAVEPOINT ${savepointName};`, { transaction });
            console.log(`  Dropping constraint: ${constraintName}`);
            await queryInterface.sequelize.query(
              `ALTER TABLE "${table.tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}" CASCADE;`,
              { transaction }
            );
            await queryInterface.sequelize.query(`RELEASE SAVEPOINT ${savepointName};`, { transaction });
          } catch (error) {
            await queryInterface.sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName};`, { transaction }).catch(() => {});
            console.warn(`  Warning: Could not drop constraint ${constraintName}:`, error.message);
          }
        }

        // Drop old unique indexes on the field (that don't include companyId)
        const fieldPattern = table.fieldName.replace(/_/g, '_');
        const indexes = await queryInterface.sequelize.query(
          `SELECT indexname, indexdef
           FROM pg_indexes
           WHERE tablename = '${table.tableName}'
             AND indexdef LIKE '%UNIQUE%'
             AND (indexdef LIKE '%(${fieldPattern})%' OR indexdef LIKE '%(${fieldPattern}, %' OR indexdef LIKE '%, ${fieldPattern})%')
             AND indexdef NOT LIKE '%companyId%'
             AND indexdef NOT LIKE '%company_id%'
             AND indexname NOT LIKE '%pkey%'
           ORDER BY indexname;`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );

        for (const index of indexes) {
          const indexName = index.indexname;
          const savepointName = `sp_drop_index_${indexName.replace(/[^a-zA-Z0-9]/g, '_')}`;
          try {
            await queryInterface.sequelize.query(`SAVEPOINT ${savepointName};`, { transaction });
            console.log(`  Dropping index: ${indexName}`);
            await queryInterface.sequelize.query(
              `DROP INDEX IF EXISTS "${indexName}" CASCADE;`,
              { transaction }
            );
            await queryInterface.sequelize.query(`RELEASE SAVEPOINT ${savepointName};`, { transaction });
          } catch (error) {
            await queryInterface.sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName};`, { transaction }).catch(() => {});
            console.warn(`  Warning: Could not drop index ${indexName}:`, error.message);
          }
        }

        // Check for duplicate data before creating unique index
        // Use quoted field name to handle camelCase fields
        const quotedFieldName = `"${table.fieldName}"`;
        let duplicates = [];
        const savepointName = `sp_check_duplicates_${table.tableName}`;
        try {
          await queryInterface.sequelize.query(`SAVEPOINT ${savepointName};`, { transaction });
          duplicates = await queryInterface.sequelize.query(
            `SELECT ${quotedFieldName}, "companyId", COUNT(*) as count
             FROM "${table.tableName}"
             GROUP BY ${quotedFieldName}, "companyId"
             HAVING COUNT(*) > 1;`,
            { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
          );
          await queryInterface.sequelize.query(`RELEASE SAVEPOINT ${savepointName};`, { transaction });
        } catch (error) {
          // Column might not exist or table structure is different - rollback to savepoint
          await queryInterface.sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName};`, { transaction }).catch(() => {});
          console.warn(`  ⚠️  Could not check for duplicates (column may not exist): ${error.message}`);
          console.warn(`     Skipping this table - column structure may be different.`);
          continue; // Skip this table
        }

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
          } else {
            console.log(`  Composite unique index ${table.indexName} already exists`);
          }
        }
      }

      await transaction.commit();
      console.log('\n✅ Successfully fixed Priority 2 unique constraints for multi-tenant support\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error fixing Priority 2 unique constraints:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Reverting Priority 2 unique constraints fix...\n');

      // Remove composite unique indexes
      for (const table of TABLES_TO_FIX) {
        try {
          await queryInterface.removeIndex(table.tableName, table.indexName, { transaction });
          console.log(`  Removed index: ${table.indexName}`);
        } catch (error) {
          console.warn(`  Warning: Could not remove index ${table.indexName}:`, error.message);
        }
      }

      // Note: We don't recreate the old global unique constraints in the down migration
      // because they would break multi-tenant functionality

      await transaction.commit();
      console.log('✅ Reverted Priority 2 unique constraints fix\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error reverting Priority 2 unique constraints fix:', error);
      throw error;
    }
  }
};

