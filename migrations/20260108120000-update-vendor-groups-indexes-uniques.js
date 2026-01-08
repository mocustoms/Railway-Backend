'use strict';

/**
 * Update indexes for vendor_groups table to match model expectations
 * - Remove incorrect/legacy unique indexes on vendor_group_name, liablity_account_id, payable_account_id
 * - Add unique index on vendor_group_code
 * - Ensure companyId unique index exists
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // helper to check index existence
      const indexExists = async (indexName) => {
        const res = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'vendor_groups' AND indexname = '${indexName}'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        return res && res.length > 0;
      };

      // Remove legacy / incorrect indexes if present
      const legacyIndexes = [
        'vendor_groups_vendor_group_name_key',
        'vendor_groups_liablity_account_id_key',
        'vendor_groups_payable_account_id_key'
      ];

      for (const idx of legacyIndexes) {
        if (await indexExists(idx)) {
          await queryInterface.removeIndex('vendor_groups', idx, { transaction });
        }
      }

      // Add index for vendor_group_code (unique) if not exists
      const newIdx = 'vendor_groups_vendor_group_code_key';
      if (!(await indexExists(newIdx))) {
        await queryInterface.addIndex('vendor_groups', {
          fields: ['vendor_group_code'],
          unique: true,
          name: newIdx,
          transaction
        });
      }

      const companyIdx = 'vendor_groups_company_id_key';
      if (!(await indexExists(companyIdx))) {
        await queryInterface.addIndex('vendor_groups', {
          fields: ['companyId'],
          unique: true,
          name: companyIdx,
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to update vendor_groups indexes:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // helper to check index existence
      const indexExists = async (indexName) => {
        const res = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'vendor_groups' AND indexname = '${indexName}'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        return res && res.length > 0;
      };

      // Remove the vendor_group_code index if present
      const codeIdx = 'vendor_groups_vendor_group_code_key';
      if (await indexExists(codeIdx)) {
        await queryInterface.removeIndex('vendor_groups', codeIdx, { transaction });
      }

      // Recreate legacy indexes if they do not exist
      const legacyToCreate = [
        { name: 'vendor_groups_vendor_group_name_key', fields: ['vendor_group_name'], unique: true },
        { name: 'vendor_groups_liablity_account_id_key', fields: ['liablity_account_id'], unique: true },
        { name: 'vendor_groups_payable_account_id_key', fields: ['payable_account_id'], unique: true },
        { name: 'vendor_groups_company_id_key', fields: ['companyId'], unique: true }
      ];

      for (const idx of legacyToCreate) {
        if (!(await indexExists(idx.name))) {
          await queryInterface.addIndex('vendor_groups', {
            fields: idx.fields,
            unique: idx.unique,
            name: idx.name,
            transaction
          });
        }
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to rollback vendor_groups indexes migration:', error.message);
      throw error;
    }
  }
};
