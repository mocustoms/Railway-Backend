'use strict';

/**
 * Remove unique index on vendor_groups.companyId and replace with a non-unique index
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const indexExists = async (indexName) => {
        const res = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'vendor_groups' AND indexname = '${indexName}'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        return res && res.length > 0;
      };

      const uniqueIdx = 'vendor_groups_company_id_key';
      if (await indexExists(uniqueIdx)) {
        await queryInterface.removeIndex('vendor_groups', uniqueIdx, { transaction });
      }

      const nonUniqueIdx = 'vendor_groups_company_id_idx';
      if (!(await indexExists(nonUniqueIdx))) {
        await queryInterface.addIndex('vendor_groups', {
          fields: ['companyId'],
          name: nonUniqueIdx,
          unique: false,
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to modify vendor_groups.companyId index:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const indexExists = async (indexName) => {
        const res = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'vendor_groups' AND indexname = '${indexName}'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        return res && res.length > 0;
      };

      const nonUniqueIdx = 'vendor_groups_company_id_idx';
      if (await indexExists(nonUniqueIdx)) {
        await queryInterface.removeIndex('vendor_groups', nonUniqueIdx, { transaction });
      }

      const uniqueIdx = 'vendor_groups_company_id_key';
      if (!(await indexExists(uniqueIdx))) {
        await queryInterface.addIndex('vendor_groups', {
          fields: ['companyId'],
          name: uniqueIdx,
          unique: true,
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to rollback vendor_groups.companyId index migration:', error.message);
      throw error;
    }
  }
};
