'use strict';

/**
 * Add created_by and updated_by to vendor_groups and vendors
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      console.log('🔄 Adding created_by/updated_by to vendor_groups and vendors...');

      // vendor_groups
      const vgTableExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'vendor_groups' AND column_name = 'created_by'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vgTableExists.length === 0) {
        await queryInterface.addColumn('vendor_groups', 'created_by', {
          type: Sequelize.DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE'
        }, { transaction });

        await queryInterface.addColumn('vendor_groups', 'updated_by', {
          type: Sequelize.DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE'
        }, { transaction });

        await queryInterface.addIndex('vendor_groups', {
          fields: ['created_by'],
          name: 'vendor_groups_created_by_idx',
          transaction
        });

        await queryInterface.addIndex('vendor_groups', {
          fields: ['updated_by'],
          name: 'vendor_groups_updated_by_idx',
          transaction
        });

        console.log('   ✅ vendor_groups updated');
      } else {
        console.log('   ℹ️  vendor_groups already have created_by column, skipping');
      }

      // vendors
      const vTableExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'vendors' AND column_name = 'created_by'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vTableExists.length === 0) {
        await queryInterface.addColumn('vendors', 'created_by', {
          type: Sequelize.DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE'
        }, { transaction });

        await queryInterface.addColumn('vendors', 'updated_by', {
          type: Sequelize.DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE'
        }, { transaction });

        await queryInterface.addIndex('vendors', {
          fields: ['created_by'],
          name: 'vendors_created_by_idx',
          transaction
        });

        await queryInterface.addIndex('vendors', {
          fields: ['updated_by'],
          name: 'vendors_updated_by_idx',
          transaction
        });

        console.log('   ✅ vendors updated');
      } else {
        console.log('   ℹ️  vendors already have created_by column, skipping');
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
      console.log('🔄 Removing created_by/updated_by from vendors and vendor_groups...');

      const vendorsHasCreatedBy = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'vendors' AND column_name = 'created_by'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vendorsHasCreatedBy.length > 0) {
        await queryInterface.removeIndex('vendors', 'vendors_updated_by_idx', { transaction }).catch(() => {});
        await queryInterface.removeIndex('vendors', 'vendors_created_by_idx', { transaction }).catch(() => {});
        await queryInterface.removeColumn('vendors', 'updated_by', { transaction }).catch(() => {});
        await queryInterface.removeColumn('vendors', 'created_by', { transaction }).catch(() => {});
        console.log('   ✅ vendors columns removed');
      } else {
        console.log('   ℹ️  vendors do not have created_by column, skipping');
      }

      const vgHasCreatedBy = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'vendor_groups' AND column_name = 'created_by'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vgHasCreatedBy.length > 0) {
        await queryInterface.removeIndex('vendor_groups', 'vendor_groups_updated_by_idx', { transaction }).catch(() => {});
        await queryInterface.removeIndex('vendor_groups', 'vendor_groups_created_by_idx', { transaction }).catch(() => {});
        await queryInterface.removeColumn('vendor_groups', 'updated_by', { transaction }).catch(() => {});
        await queryInterface.removeColumn('vendor_groups', 'created_by', { transaction }).catch(() => {});
        console.log('   ✅ vendor_groups columns removed');
      } else {
        console.log('   ℹ️  vendor_groups do not have created_by column, skipping');
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
