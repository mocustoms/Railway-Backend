'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    // Rename created_at -> createdAt and updated_at -> updatedAt on purchase_invoices
    const table = 'purchase_invoices';
    // Check and rename created_at
    const tableInfo = await queryInterface.describeTable(table);
    if (tableInfo.created_at) {
      await queryInterface.renameColumn(table, 'created_at', 'createdAt');
    }
    if (tableInfo.updated_at) {
      await queryInterface.renameColumn(table, 'updated_at', 'updatedAt');
    }
  },

  async down (queryInterface, Sequelize) {
    const table = 'purchase_invoices';
    const tableInfo = await queryInterface.describeTable(table);
    if (tableInfo.createdAt) {
      await queryInterface.renameColumn(table, 'createdAt', 'created_at');
    }
    if (tableInfo.updatedAt) {
      await queryInterface.renameColumn(table, 'updatedAt', 'updated_at');
    }
  }
};
