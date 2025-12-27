'use strict';

/**
 * Remove unique constraint on physical_inventories.reference_number
 * 
 * This constraint prevents multiple physical inventories from having the same
 * reference number, which is needed when the same reference number can be
 * used multiple times (e.g., when posting the same invoice reference number).
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Removing unique constraint on physical_inventories.reference_number...');
      
      // Check if the unique index exists
      const [indexes] = await queryInterface.sequelize.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'physical_inventories'
          AND indexname = 'physical_inventories_reference_number_key';
      `, {
        type: queryInterface.sequelize.QueryTypes.SELECT,
        transaction
      });
      
      if (indexes && indexes.length > 0) {
        // Drop the unique index
        await queryInterface.sequelize.query(`
          DROP INDEX IF EXISTS "physical_inventories_reference_number_key";
        `, { transaction });
        
        console.log('   ✅ Dropped unique index: physical_inventories_reference_number_key');
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
      console.log('🔄 Recreating unique constraint on physical_inventories.reference_number...');
      
      // Check if the unique index exists
      const [indexes] = await queryInterface.sequelize.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'physical_inventories'
          AND indexname = 'physical_inventories_reference_number_key';
      `, {
        type: queryInterface.sequelize.QueryTypes.SELECT,
        transaction
      });
      
      if (!indexes || indexes.length === 0) {
        // Create the unique index
        await queryInterface.sequelize.query(`
          CREATE UNIQUE INDEX "physical_inventories_reference_number_key"
          ON physical_inventories (reference_number);
        `, { transaction });
        
        console.log('   ✅ Created unique index: physical_inventories_reference_number_key');
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

