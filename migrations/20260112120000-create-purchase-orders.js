"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('purchase_orders', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      po_number: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: false
      },
      order_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      expected_delivery_date: {
        type: Sequelize.DATEONLY,
        allowNull: true
      },
      vendor_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      store_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      currency_id: {
        type: Sequelize.UUID,
        allowNull: true
      },
      exchange_rate: {
        type: Sequelize.DECIMAL(18,6),
        allowNull: false,
        defaultValue: 1
      },
      shipping_cost: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0
      },
      subtotal_amount: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0
      },
      tax_amount: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0
      },
      discount_amount: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0
      },
      total_amount: {
        type: Sequelize.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0
      },
      status: {
        type: Sequelize.ENUM('draft','ordered','partially_received','received','cancelled'),
        allowNull: false,
        defaultValue: 'draft'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: false
      },
      updated_by: {
        type: Sequelize.UUID,
        allowNull: true
      },
      companyId: {
        type: Sequelize.UUID,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    await queryInterface.addIndex('purchase_orders', ['vendor_id']);
    await queryInterface.addIndex('purchase_orders', ['store_id']);
    await queryInterface.addIndex('purchase_orders', ['companyId']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('purchase_orders');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_purchase_orders_status"');
  }
};
