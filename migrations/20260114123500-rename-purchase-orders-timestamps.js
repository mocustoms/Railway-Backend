'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    const table = 'purchase_orders';
    const tableInfo = await queryInterface.describeTable(table);
    if (tableInfo.created_at) {
      await queryInterface.renameColumn(table, 'created_at', 'createdAt');
    }
    if (tableInfo.updated_at) {
      await queryInterface.renameColumn(table, 'updated_at', 'updatedAt');
    }
  },

  async down (queryInterface, Sequelize) {
    const table = 'purchase_orders';
    const tableInfo = await queryInterface.describeTable(table);
    if (tableInfo.createdAt) {
      await queryInterface.renameColumn(table, 'createdAt', 'created_at');
    }
    if (tableInfo.updatedAt) {
      await queryInterface.renameColumn(table, 'updatedAt', 'updated_at');
    }
  }
};
