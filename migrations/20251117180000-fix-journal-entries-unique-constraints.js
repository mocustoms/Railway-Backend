'use strict';

/**
 * Fix Journal Entries Unique Constraints for Multi-Tenant Support
 * 
 * This migration:
 * 1. Drops old global unique constraints on journal_entries.reference_number
 * 2. Ensures composite unique index with companyId is in place
 * 
 * This allows different companies to have journal entries with the same reference number.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Fixing journal_entries unique constraints for multi-tenant support...\n');

      // Get all existing unique constraints on journal_entries.reference_number
      const referenceConstraints = await queryInterface.sequelize.query(
        `SELECT constraint_name 
         FROM information_schema.table_constraints 
         WHERE table_name = 'journal_entries' 
           AND constraint_type = 'UNIQUE' 
           AND constraint_name LIKE '%reference%'
           AND constraint_name NOT LIKE '%companyId%'
           AND constraint_name NOT LIKE '%company_id%'
           AND constraint_name NOT LIKE '%pkey%'
         ORDER BY constraint_name;`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      // Drop all old global unique constraints on reference_number (that don't include companyId)
      for (const constraint of referenceConstraints) {
        const constraintName = constraint.constraint_name;
        // Use SAVEPOINT to isolate each drop operation
        const savepointName = `sp_drop_constraint_${constraintName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        try {
          await queryInterface.sequelize.query(`SAVEPOINT ${savepointName};`, { transaction });
          console.log(`  Dropping constraint: ${constraintName}`);
          await queryInterface.sequelize.query(
            `ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS "${constraintName}" CASCADE;`,
            { transaction }
          );
          await queryInterface.sequelize.query(`RELEASE SAVEPOINT ${savepointName};`, { transaction });
        } catch (error) {
          // Rollback to savepoint and continue
          await queryInterface.sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName};`, { transaction }).catch(() => {});
          console.warn(`  Warning: Could not drop constraint ${constraintName}:`, error.message);
          // Continue with next constraint
        }
      }

      // Drop old unique indexes on reference_number (that don't include companyId)
      const referenceIndexes = await queryInterface.sequelize.query(
        `SELECT indexname, indexdef
         FROM pg_indexes 
         WHERE tablename = 'journal_entries' 
           AND indexdef LIKE '%UNIQUE%'
           AND (indexdef LIKE '%(reference_number)%' OR indexdef LIKE '%(reference_number, %' OR indexdef LIKE '%, reference_number)%')
           AND indexdef NOT LIKE '%companyId%'
           AND indexdef NOT LIKE '%company_id%'
           AND indexname NOT LIKE '%pkey%'
         ORDER BY indexname;`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      for (const index of referenceIndexes) {
        const indexName = index.indexname;
        // Use SAVEPOINT to isolate each drop operation
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
          // Rollback to savepoint and continue
          await queryInterface.sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName};`, { transaction }).catch(() => {});
          console.warn(`  Warning: Could not drop index ${indexName}:`, error.message);
          // Try to continue - the index might be a constraint that was already dropped
        }
      }

      // Ensure composite unique index on (reference_number, companyId) exists
      const referenceCompanyIndexExists = await queryInterface.sequelize.query(
        `SELECT 1 
         FROM pg_indexes 
         WHERE tablename = 'journal_entries' 
           AND indexname = 'journal_entries_reference_number_companyId_unique';`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (referenceCompanyIndexExists.length === 0) {
        console.log('  Creating composite unique index: journal_entries_reference_number_companyId_unique');
        await queryInterface.addIndex('journal_entries', ['reference_number', 'companyId'], {
          unique: true,
          name: 'journal_entries_reference_number_companyId_unique',
          transaction
        });
      } else {
        console.log('  Composite unique index journal_entries_reference_number_companyId_unique already exists');
      }

      await transaction.commit();
      console.log('✅ Successfully fixed journal_entries unique constraints for multi-tenant support\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error fixing journal_entries unique constraints:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Reverting journal_entries unique constraints fix...\n');

      // Remove composite unique index
      try {
        await queryInterface.removeIndex('journal_entries', 'journal_entries_reference_number_companyId_unique', { transaction });
        console.log('  Removed index: journal_entries_reference_number_companyId_unique');
      } catch (error) {
        console.warn('  Warning: Could not remove index journal_entries_reference_number_companyId_unique:', error.message);
      }

      // Note: We don't recreate the old global unique constraints in the down migration
      // because they would break multi-tenant functionality

      await transaction.commit();
      console.log('✅ Reverted journal_entries unique constraints fix\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error reverting journal_entries unique constraints fix:', error);
      throw error;
    }
  }
};

