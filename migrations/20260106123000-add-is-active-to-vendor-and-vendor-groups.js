'use strict';

/**
 * Add is_active column to vendor_groups and vendors
 * - Adds `is_active` BOOLEAN NOT NULL DEFAULT true to both tables
 * - Safe checks: only add if the column does not already exist
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      console.log('🔄 Adding is_active column to vendor_groups and vendors...');

      // vendor_groups
      const vgCol = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'vendor_groups'
         AND column_name = 'is_active'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vgCol.length === 0) {
        await queryInterface.addColumn(
          'vendor_groups',
          'is_active',
          {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          { transaction }
        );
        console.log('   ✅ Added is_active to vendor_groups');
      } else {
        console.log('   ℹ️  vendor_groups.is_active already exists, skipping');
      }

      // vendors
      const vCol = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'vendors'
         AND column_name = 'is_active'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vCol.length === 0) {
        await queryInterface.addColumn(
          'vendors',
          'is_active',
          {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          { transaction }
        );
        console.log('   ✅ Added is_active to vendors');
      } else {
        console.log('   ℹ️  vendors.is_active already exists, skipping');
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
      console.log('🔄 Removing is_active column from vendors and vendor_groups...');

      // vendors first
      const vColDown = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'vendors'
         AND column_name = 'is_active'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vColDown.length > 0) {
        await queryInterface.removeColumn('vendors', 'is_active', { transaction });
        console.log('   ✅ Removed is_active from vendors');
      } else {
        console.log('   ℹ️  vendors.is_active not present, skipping');
      }

      // vendor_groups
      const vgColDown = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'vendor_groups'
         AND column_name = 'is_active'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vgColDown.length > 0) {
        await queryInterface.removeColumn('vendor_groups', 'is_active', { transaction });
        console.log('   ✅ Removed is_active from vendor_groups');
      } else {
        console.log('   ℹ️  vendor_groups.is_active not present, skipping');
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
