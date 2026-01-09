'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const exists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendor_products'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (exists.length === 0) {
        await queryInterface.createTable('vendor_products', {
          id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true
          },
          vendor_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'vendors', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          product_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'products', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          companyId: {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: { model: 'company', key: 'id' }
          },
          created_at: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
          updated_at: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
        }, { transaction });

        await queryInterface.addIndex('vendor_products', { fields: ['vendor_id', 'product_id'], unique: true, name: 'vendor_products_vendor_product_key', transaction });
        await queryInterface.addIndex('vendor_products', { fields: ['vendor_id'], name: 'vendor_products_vendor_id_idx', transaction });
        await queryInterface.addIndex('vendor_products', { fields: ['product_id'], name: 'vendor_products_product_id_idx', transaction });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to create vendor_products table:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const exists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendor_products'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (exists.length > 0) {
        await queryInterface.dropTable('vendor_products', { transaction });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to drop vendor_products table:', error.message);
      throw error;
    }
  }
};
