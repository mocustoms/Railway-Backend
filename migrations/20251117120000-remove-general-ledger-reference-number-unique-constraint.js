'use strict';

/**
 * Remove unique constraint on general_ledger (reference_number, companyId)
 * 
 * This constraint prevents multiple General Ledger entries from having the same
 * reference number for the same company, which is needed for transactions like
 * stock adjustments and physical inventories that create multiple GL entries
 * (debit and credit) with the same reference number.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Removing unique constraint on general_ledger (reference_number, companyId)...');
      
      // Check if the unique index exists
      const [indexes] = await queryInterface.sequelize.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'general_ledger'
          AND indexname = 'general_ledger_reference_number_companyId_unique';
      `, {
        type: queryInterface.sequelize.QueryTypes.SELECT,
        transaction
      });
      
      if (indexes && indexes.length > 0) {
        // Drop the unique index
        await queryInterface.sequelize.query(`
          DROP INDEX IF EXISTS "general_ledger_reference_number_companyId_unique";
        `, { transaction });
        
        console.log('   ✅ Dropped unique index: general_ledger_reference_number_companyId_unique');
      } else {
        console.log('   ℹ️  Unique index does not exist, skipping');
      }
      
      await transaction.commit();
      console.log('✅ Migration completed successfully');
      
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Recreating unique constraint on general_ledger (reference_number, companyId)...');
      
      // Check if the unique index exists
      const [indexes] = await queryInterface.sequelize.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'general_ledger'
          AND indexname = 'general_ledger_reference_number_companyId_unique';
      `, {
        type: queryInterface.sequelize.QueryTypes.SELECT,
        transaction
      });
      
      if (!indexes || indexes.length === 0) {
        // Create the unique index
        await queryInterface.sequelize.query(`
          CREATE UNIQUE INDEX "general_ledger_reference_number_companyId_unique"
          ON general_ledger (reference_number, "companyId");
        `, { transaction });
        
        console.log('   ✅ Created unique index: general_ledger_reference_number_companyId_unique');
      } else {
        console.log('   ℹ️  Unique index already exists, skipping');
      }
      
      await transaction.commit();
      console.log('✅ Rollback completed successfully');
      
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Rollback failed:', error.message);
      throw error;
    }
  }
};

