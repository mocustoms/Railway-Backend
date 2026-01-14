"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('purchase_invoice_payments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('uuid_generate_v4()'), primaryKey: true },
      purchase_invoice_id: { type: Sequelize.UUID, allowNull: false },
      paid_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      amount: { type: Sequelize.DECIMAL(18,2), allowNull: false },
      method: { type: Sequelize.STRING, allowNull: true },
      reference: { type: Sequelize.STRING, allowNull: true },
      created_by: { type: Sequelize.UUID, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('purchase_invoice_payments', ['purchase_invoice_id']);
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('purchase_invoice_payments');
  }
};
