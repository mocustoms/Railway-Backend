'use strict';

/**
 * Fix Account Types Unique Constraints for Multi-Tenant Support
 * 
 * This migration:
 * 1. Drops old global unique constraints on account_types.code and account_types.name
 * 2. Ensures composite unique indexes with companyId are in place
 * 
 * This allows different companies to have account types with the same name or code.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Fixing account_types unique constraints for multi-tenant support...\n');

      // Get all existing unique constraints on account_types.code
      const codeConstraints = await queryInterface.sequelize.query(
        `SELECT constraint_name 
         FROM information_schema.table_constraints 
         WHERE table_name = 'account_types' 
           AND constraint_type = 'UNIQUE' 
           AND constraint_name LIKE '%code%'
         ORDER BY constraint_name;`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      // Get all existing unique constraints on account_types.name
      const nameConstraints = await queryInterface.sequelize.query(
        `SELECT constraint_name 
         FROM information_schema.table_constraints 
         WHERE table_name = 'account_types' 
           AND constraint_type = 'UNIQUE' 
           AND constraint_name LIKE '%name%'
         ORDER BY constraint_name;`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      // Drop all old global unique constraints on code (that don't include companyId)
      for (const constraint of codeConstraints) {
        const constraintName = constraint.constraint_name;
        // Skip composite constraints that include companyId
        if (!constraintName.includes('companyId') && !constraintName.includes('company_id')) {
          try {
            console.log(`  Dropping constraint: ${constraintName}`);
            await queryInterface.sequelize.query(
              `ALTER TABLE account_types DROP CONSTRAINT IF EXISTS "${constraintName}" CASCADE;`,
              { transaction }
            );
          } catch (error) {
            console.warn(`  Warning: Could not drop constraint ${constraintName}:`, error.message);
          }
        }
      }

      // Drop all old global unique constraints on name (that don't include companyId)
      for (const constraint of nameConstraints) {
        const constraintName = constraint.constraint_name;
        // Skip composite constraints that include companyId
        if (!constraintName.includes('companyId') && !constraintName.includes('company_id')) {
          try {
            console.log(`  Dropping constraint: ${constraintName}`);
            await queryInterface.sequelize.query(
              `ALTER TABLE account_types DROP CONSTRAINT IF EXISTS "${constraintName}" CASCADE;`,
              { transaction }
            );
          } catch (error) {
            console.warn(`  Warning: Could not drop constraint ${constraintName}:`, error.message);
          }
        }
      }

      // Drop old unique indexes on code (that don't include companyId)
      const codeIndexes = await queryInterface.sequelize.query(
        `SELECT indexname 
         FROM pg_indexes 
         WHERE tablename = 'account_types' 
           AND indexname LIKE '%code%'
           AND indexdef LIKE '%UNIQUE%'
         ORDER BY indexname;`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      for (const index of codeIndexes) {
        const indexName = index.indexname;
        // Skip composite indexes that include companyId
        if (!indexName.includes('companyId') && !indexName.includes('company_id')) {
          try {
            console.log(`  Dropping index: ${indexName}`);
            await queryInterface.sequelize.query(
              `DROP INDEX IF EXISTS "${indexName}" CASCADE;`,
              { transaction }
            );
          } catch (error) {
            console.warn(`  Warning: Could not drop index ${indexName}:`, error.message);
          }
        }
      }

      // Drop old unique indexes on name (that don't include companyId)
      const nameIndexes = await queryInterface.sequelize.query(
        `SELECT indexname 
         FROM pg_indexes 
         WHERE tablename = 'account_types' 
           AND indexname LIKE '%name%'
           AND indexdef LIKE '%UNIQUE%'
         ORDER BY indexname;`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      for (const nameIndex of nameIndexes) {
        const indexName = nameIndex.indexname;
        // Skip composite indexes that include companyId
        if (!indexName.includes('companyId') && !indexName.includes('company_id')) {
          try {
            console.log(`  Dropping index: ${indexName}`);
            await queryInterface.sequelize.query(
              `DROP INDEX IF EXISTS "${indexName}" CASCADE;`,
              { transaction }
            );
          } catch (error) {
            console.warn(`  Warning: Could not drop index ${indexName}:`, error.message);
          }
        }
      }

      // Ensure composite unique index on (code, companyId) exists
      const codeCompanyIndexExists = await queryInterface.sequelize.query(
        `SELECT 1 
         FROM pg_indexes 
         WHERE tablename = 'account_types' 
           AND indexname = 'account_types_code_companyId_unique';`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (codeCompanyIndexExists.length === 0) {
        console.log('  Creating composite unique index: account_types_code_companyId_unique');
        await queryInterface.addIndex('account_types', ['code', 'companyId'], {
          unique: true,
          name: 'account_types_code_companyId_unique',
          transaction
        });
      } else {
        console.log('  Composite unique index account_types_code_companyId_unique already exists');
      }

      // Ensure composite unique index on (name, companyId) exists
      const nameCompanyIndexExists = await queryInterface.sequelize.query(
        `SELECT 1 
         FROM pg_indexes 
         WHERE tablename = 'account_types' 
           AND indexname = 'account_types_name_companyId_unique';`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (nameCompanyIndexExists.length === 0) {
        console.log('  Creating composite unique index: account_types_name_companyId_unique');
        await queryInterface.addIndex('account_types', ['name', 'companyId'], {
          unique: true,
          name: 'account_types_name_companyId_unique',
          transaction
        });
      } else {
        console.log('  Composite unique index account_types_name_companyId_unique already exists');
      }

      await transaction.commit();
      console.log('✅ Successfully fixed account_types unique constraints for multi-tenant support\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error fixing account_types unique constraints:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Reverting account_types unique constraints fix...\n');

      // Remove composite unique indexes
      try {
        await queryInterface.removeIndex('account_types', 'account_types_code_companyId_unique', { transaction });
        console.log('  Removed index: account_types_code_companyId_unique');
      } catch (error) {
        console.warn('  Warning: Could not remove index account_types_code_companyId_unique:', error.message);
      }

      try {
        await queryInterface.removeIndex('account_types', 'account_types_name_companyId_unique', { transaction });
        console.log('  Removed index: account_types_name_companyId_unique');
      } catch (error) {
        console.warn('  Warning: Could not remove index account_types_name_companyId_unique:', error.message);
      }

      // Note: We don't recreate the old global unique constraints in the down migration
      // because they would break multi-tenant functionality

      await transaction.commit();
      console.log('✅ Reverted account_types unique constraints fix\n');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error reverting account_types unique constraints fix:', error);
      throw error;
    }
  }
};

