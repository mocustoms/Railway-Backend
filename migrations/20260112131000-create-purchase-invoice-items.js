"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('purchase_invoice_items', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('uuid_generate_v4()'), primaryKey: true },
      purchase_invoice_id: { type: Sequelize.UUID, allowNull: false },
      product_id: { type: Sequelize.UUID, allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      quantity: { type: Sequelize.DECIMAL(18,3), allowNull: false },
      unit_price: { type: Sequelize.DECIMAL(18,2), allowNull: false },
      discount_percentage: { type: Sequelize.DECIMAL(5,2), allowNull: true },
      discount_amount: { type: Sequelize.DECIMAL(18,2), allowNull: true },
      tax_percentage: { type: Sequelize.DECIMAL(5,2), allowNull: true },
      tax_amount: { type: Sequelize.DECIMAL(18,2), allowNull: true },
      line_subtotal: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      line_total: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addIndex('purchase_invoice_items', ['purchase_invoice_id']);
    await queryInterface.addIndex('purchase_invoice_items', ['product_id']);
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('purchase_invoice_items');
  }
};
