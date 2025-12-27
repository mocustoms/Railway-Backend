'use strict';

/**
 * Fix Tax Codes Unique Constraints for Multi-Tenant Support
 * 
 * This migration:
 * 1. Drops old global unique constraints on tax_codes.code
 * 2. Ensures composite unique index with companyId is in place
 * 
 * This allows different companies to have tax codes with the same code.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Fixing tax_codes unique constraints for multi-tenant support...\n');

      // Get all existing unique constraints on tax_codes.code
      const codeConstraints = await queryInterface.sequelize.query(
        `SELECT constraint_name 
         FROM information_schema.table_constraints 
         WHERE table_name = 'tax_codes' 
           AND constraint_type = 'UNIQUE' 
           AND constraint_name LIKE '%code%'
           AND constraint_name NOT LIKE '%companyId%'
           AND constraint_name NOT LIKE '%company_id%'
           AND constraint_name NOT LIKE '%pkey%'
         ORDER BY constraint_name;`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      // Drop all old global unique constraints on code (that don't include companyId)
      for (const constraint of codeConstraints) {
        const constraintName = constraint.constraint_name;
        // Use SAVEPOINT to isolate each drop operation
        const savepointName = `sp_drop_constraint_${constraintName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        try {
          await queryInterface.sequelize.query(`SAVEPOINT ${savepointName};`, { transaction });
          console.log(`  Dropping constraint: ${constraintName}`);
          await queryInterface.sequelize.query(
            `ALTER TABLE tax_codes DROP CONSTRAINT IF EXISTS "${constraintName}" CASCADE;`,
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

      // Drop old unique indexes on code (that don't include companyId)
      // Filter to only indexes that are on the code column (not just have 'code' in the name)
      const codeIndexes = await queryInterface.sequelize.query(
        `SELECT indexname, indexdef
         FROM pg_indexes 
         WHERE tablename = 'tax_codes' 
           AND indexdef LIKE '%UNIQUE%'
           AND (indexdef LIKE '%(code)%' OR indexdef LIKE '%(code, %' OR indexdef LIKE '%, code)%')
           AND indexdef NOT LIKE '%companyId%'
           AND indexdef NOT LIKE '%company_id%'
           AND indexname NOT LIKE '%pkey%'
         ORDER BY indexname;`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      for (const index of codeIndexes) {
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

      // Ensure composite unique index on (code, companyId) exists
      const codeCompanyIndexExists = await queryInterface.sequelize.query(
        `SELECT 1 
         FROM pg_indexes 
         WHERE tablename = 'tax_codes' 
           AND indexname = 'tax_codes_code_companyId_unique';`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (codeCompanyIndexExists.length === 0) {
        console.log('  Creating composite unique index: tax_codes_code_companyId_unique');
        await queryInterface.addIndex('tax_codes', ['code', 'companyId'], {
          unique: true,
          name: 'tax_codes_code_companyId_unique',
          transaction
        });
      } else {
        console.log('  Composite unique index tax_codes_code_companyId_unique already exists');
      }

      await transaction.commit();
      console.log('✅ Successfully fixed tax_codes unique constraints for multi-tenant support\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error fixing tax_codes unique constraints:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Reverting tax_codes unique constraints fix...\n');

      // Remove composite unique index
      try {
        await queryInterface.removeIndex('tax_codes', 'tax_codes_code_companyId_unique', { transaction });
        console.log('  Removed index: tax_codes_code_companyId_unique');
      } catch (error) {
        console.warn('  Warning: Could not remove index tax_codes_code_companyId_unique:', error.message);
      }

      // Note: We don't recreate the old global unique constraints in the down migration
      // because they would break multi-tenant functionality

      await transaction.commit();
      console.log('✅ Reverted tax_codes unique constraints fix\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error reverting tax_codes unique constraints fix:', error);
      throw error;
    }
  }
};

