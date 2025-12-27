'use strict';

/**
 * Fix Priority 1 Unique Constraints for Multi-Tenant Support
 * 
 * This migration fixes unique constraints for transaction documents:
 * 1. sales_invoices.invoice_ref_number
 * 2. sales_orders.sales_order_ref_number
 * 3. proforma_invoices.proforma_ref_number
 * 4. stock_adjustments.reference_number
 * 5. store_requests.reference_number
 * 6. openingBalances.referenceNumber
 * 7. general_ledger.reference_number
 * 
 * For each table:
 * - Drops old global unique constraints/indexes
 * - Ensures composite unique index with companyId is in place
 * 
 * This allows different companies to have the same reference numbers.
 */

const TABLES_TO_FIX = [
  {
    tableName: 'sales_invoices',
    fieldName: 'invoice_ref_number',
    indexName: 'sales_invoices_invoice_ref_number_companyId_unique'
  },
  {
    tableName: 'sales_orders',
    fieldName: 'sales_order_ref_number',
    indexName: 'sales_orders_sales_order_ref_number_companyId_unique'
  },
  {
    tableName: 'proforma_invoices',
    fieldName: 'proforma_ref_number',
    indexName: 'proforma_invoices_proforma_ref_number_companyId_unique'
  },
  {
    tableName: 'stock_adjustments',
    fieldName: 'reference_number',
    indexName: 'stock_adjustments_reference_number_companyId_unique'
  },
  {
    tableName: 'store_requests',
    fieldName: 'reference_number',
    indexName: 'store_requests_reference_number_companyId_unique'
  },
  {
    tableName: 'openingBalances',
    fieldName: 'referenceNumber',
    indexName: 'openingBalances_referenceNumber_companyId_unique'
  },
  // Note: general_ledger.reference_number should NOT be unique
  // Multiple ledger entries can share the same reference_number (double-entry bookkeeping)
  // {
  //   tableName: 'general_ledger',
  //   fieldName: 'reference_number',
  //   indexName: 'general_ledger_reference_number_companyId_unique'
  // }
];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Fixing Priority 1 unique constraints for multi-tenant support...\n');

      for (const table of TABLES_TO_FIX) {
        console.log(`\n📋 Processing ${table.tableName}...`);

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
        const duplicates = await queryInterface.sequelize.query(
          `SELECT ${quotedFieldName}, "companyId", COUNT(*) as count
           FROM "${table.tableName}"
           GROUP BY ${quotedFieldName}, "companyId"
           HAVING COUNT(*) > 1;`,
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
          } else {
            console.log(`  Composite unique index ${table.indexName} already exists`);
          }
        }
      }

      await transaction.commit();
      console.log('\n✅ Successfully fixed Priority 1 unique constraints for multi-tenant support\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error fixing Priority 1 unique constraints:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Reverting Priority 1 unique constraints fix...\n');

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
      console.log('✅ Reverted Priority 1 unique constraints fix\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error reverting Priority 1 unique constraints fix:', error);
      throw error;
    }
  }
};

