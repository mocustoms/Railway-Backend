'use strict';

/**
 * Make vendor_groups.liablity_account_id and vendor_groups.payable_account_id nullable
 * - Changes both columns to allow NULL (allowNull: true)
 * - Down migration attempts to revert to NOT NULL but will fail if NULL values are present
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      console.log('🔄 Making vendor_groups account foreign keys nullable...');

      const tableExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'vendor_groups'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (tableExists.length === 0) {
        console.log('   ℹ️  vendor_groups table does not exist, skipping');
        await transaction.commit();
        return;
      }

      // Change liablity_account_id -> allowNull: true
      const liabCol = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'vendor_groups' AND column_name = 'liablity_account_id'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (liabCol.length > 0) {
        await queryInterface.changeColumn(
          'vendor_groups',
          'liablity_account_id',
          {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: { model: 'accounts', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          { transaction }
        );
        console.log('   ✅ Set vendor_groups.liablity_account_id to allow NULL');
      } else {
        console.log('   ℹ️  vendor_groups.liablity_account_id not present, skipping');
      }

      // Change payable_account_id -> allowNull: true
      const payCol = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'vendor_groups' AND column_name = 'payable_account_id'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (payCol.length > 0) {
        await queryInterface.changeColumn(
          'vendor_groups',
          'payable_account_id',
          {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: { model: 'accounts', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          { transaction }
        );
        console.log('   ✅ Set vendor_groups.payable_account_id to allow NULL');
      } else {
        console.log('   ℹ️  vendor_groups.payable_account_id not present, skipping');
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
      console.log('🔄 Reverting vendor_groups account foreign keys to NOT NULL...');

      const tableExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'vendor_groups'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (tableExists.length === 0) {
        console.log('   ℹ️  vendor_groups table does not exist, skipping');
        await transaction.commit();
        return;
      }

      // Ensure no NULLs exist before changing to NOT NULL
      const nulls = await queryInterface.sequelize.query(
        `SELECT COUNT(*)::integer AS cnt FROM vendor_groups
         WHERE liablity_account_id IS NULL OR payable_account_id IS NULL`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      const count = (nulls && nulls.length > 0) ? (nulls[0].cnt || nulls[0].count || 0) : 0;
      if (count > 0) {
        throw new Error(`Cannot revert: found ${count} rows in vendor_groups with NULL account references. Please populate or remove those rows before running the down migration.`);
      }

      // Change liablity_account_id -> allowNull: false
      const liabCol = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'vendor_groups' AND column_name = 'liablity_account_id'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (liabCol.length > 0) {
        await queryInterface.changeColumn(
          'vendor_groups',
          'liablity_account_id',
          {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'accounts', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          { transaction }
        );
        console.log('   ✅ Set vendor_groups.liablity_account_id to NOT NULL');
      }

      // Change payable_account_id -> allowNull: false
      const payCol = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'vendor_groups' AND column_name = 'payable_account_id'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (payCol.length > 0) {
        await queryInterface.changeColumn(
          'vendor_groups',
          'payable_account_id',
          {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'accounts', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          { transaction }
        );
        console.log('   ✅ Set vendor_groups.payable_account_id to NOT NULL');
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
