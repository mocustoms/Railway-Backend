"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('purchase_invoices', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('uuid_generate_v4()'), primaryKey: true },
      invoice_number: { type: Sequelize.STRING, allowNull: true },
      invoice_date: { type: Sequelize.DATEONLY, allowNull: false },
      due_date: { type: Sequelize.DATEONLY, allowNull: true },
      vendor_id: { type: Sequelize.UUID, allowNull: false },
      store_id: { type: Sequelize.UUID, allowNull: true },
      purchase_order_id: { type: Sequelize.UUID, allowNull: true },
      currency_id: { type: Sequelize.UUID, allowNull: true },
      exchange_rate: { type: Sequelize.DECIMAL(18,6), allowNull: false, defaultValue: 1 },
      reference: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.ENUM('draft','posted','partially_paid','paid','cancelled'), allowNull: false, defaultValue: 'draft' },
      subtotal_amount: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      discount_amount: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      tax_amount: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      shipping_cost: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      total_amount: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      balance_due: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_by: { type: Sequelize.UUID, allowNull: false },
      updated_by: { type: Sequelize.UUID, allowNull: true },
      companyId: { type: Sequelize.UUID, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: true },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addIndex('purchase_invoices', ['vendor_id']);
    await queryInterface.addIndex('purchase_invoices', ['purchase_order_id']);
    await queryInterface.addIndex('purchase_invoices', ['companyId']);
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('purchase_invoices');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_purchase_invoices_status"');
  }
};
