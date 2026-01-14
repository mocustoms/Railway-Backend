"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('purchase_order_items', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      purchase_order_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      product_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      quantity_ordered: {
        type: Sequelize.DECIMAL(18,3),
        allowNull: false
      },
      quantity_received: {
        type: Sequelize.DECIMAL(18,3),
        allowNull: false,
        defaultValue: 0
      },
      unit_price: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: false
      },
      discount_percentage: {
        type: Sequelize.DECIMAL(5,2),
        allowNull: true
      },
      discount_amount: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: true
      },
      tax_percentage: {
        type: Sequelize.DECIMAL(5,2),
        allowNull: true
      },
      tax_amount: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: true
      },
      line_subtotal: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0
      },
      line_total: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    await queryInterface.addIndex('purchase_order_items', ['purchase_order_id']);
    await queryInterface.addIndex('purchase_order_items', ['product_id']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('purchase_order_items');
  }
};
