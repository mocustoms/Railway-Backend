"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create table only if it doesn't already exist
    let tableExists = true;
    try {
      await queryInterface.describeTable('return_outs');
    } catch (err) {
      tableExists = false;
    }

    if (!tableExists) {
      await queryInterface.createTable('return_outs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      return_date: { type: Sequelize.DATEONLY, allowNull: false },
      store_id: { type: Sequelize.UUID, allowNull: false },
      vendor_id: { type: Sequelize.UUID, allowNull: true },
      return_reason_id: { type: Sequelize.UUID, allowNull: true },
      currency_id: { type: Sequelize.UUID, allowNull: true },
      exchange_rate: { type: Sequelize.DECIMAL(18,6), allowNull: false, defaultValue: 1 },
      notes: { type: Sequelize.TEXT, allowNull: true },
      total_amount: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM('draft','confirmed','cancelled'), allowNull: false, defaultValue: 'draft' },
      created_by: { type: Sequelize.UUID, allowNull: false },
      updated_by: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
      company_id: { type: Sequelize.UUID, allowNull: false }
    });

      // Add indexes if they do not exist
      const existingIndexes = await queryInterface.showIndex('return_outs');
  const hasIndexOn = (col) => existingIndexes.some(ix => ix.fields && ix.fields.some(f => f.attribute === col || f.name === col));

  if (!hasIndexOn('store_id')) await queryInterface.addIndex('return_outs', ['store_id']);
  if (!hasIndexOn('vendor_id')) await queryInterface.addIndex('return_outs', ['vendor_id']);
  if (!hasIndexOn('return_reason_id')) await queryInterface.addIndex('return_outs', ['return_reason_id']);
  if (!hasIndexOn('currency_id')) await queryInterface.addIndex('return_outs', ['currency_id']);
  // if (!hasIndexOn('companyId')) await queryInterface.addIndex('return_outs', ['companyId']);
    } else {
      // Table exists - ensure requested indexes exist
      const existingIndexes = await queryInterface.showIndex('return_outs');
  const hasIndexOn = (col) => existingIndexes.some(ix => ix.fields && ix.fields.some(f => f.attribute === col || f.name === col));
  if (!hasIndexOn('store_id')) await queryInterface.addIndex('return_outs', ['store_id']);
  if (!hasIndexOn('vendor_id')) await queryInterface.addIndex('return_outs', ['vendor_id']);
  if (!hasIndexOn('return_reason_id')) await queryInterface.addIndex('return_outs', ['return_reason_id']);
  if (!hasIndexOn('currency_id')) await queryInterface.addIndex('return_outs', ['currency_id']);
  // if (!hasIndexOn('company_id')) await queryInterface.addIndex('return_outs', ['companyId']);
    }
  },

  async down(queryInterface) {
    // Drop table only if it exists
    let tableExists = true;
    try {
      await queryInterface.describeTable('return_outs');
    } catch (err) {
      tableExists = false;
    }
    if (tableExists) {
      await queryInterface.dropTable('return_outs');
    }
  }
};
