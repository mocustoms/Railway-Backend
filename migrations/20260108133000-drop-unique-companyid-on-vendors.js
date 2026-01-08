'use strict';

/**
 * Remove unique index on vendors.companyId and replace with a non-unique index
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const indexExists = async (indexName) => {
        const res = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'vendors' AND indexname = '${indexName}'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        return res && res.length > 0;
      };

      const uniqueIdx = 'vendors_company_id_key';
      if (await indexExists(uniqueIdx)) {
        await queryInterface.removeIndex('vendors', uniqueIdx, { transaction });
      }

      const nonUniqueIdx = 'vendors_company_id_idx';
      if (!(await indexExists(nonUniqueIdx))) {
        await queryInterface.addIndex('vendors', {
          fields: ['companyId'],
          name: nonUniqueIdx,
          unique: false,
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to modify vendors.companyId index:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const indexExists = async (indexName) => {
        const res = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'vendors' AND indexname = '${indexName}'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        return res && res.length > 0;
      };

      const nonUniqueIdx = 'vendors_company_id_idx';
      if (await indexExists(nonUniqueIdx)) {
        await queryInterface.removeIndex('vendors', nonUniqueIdx, { transaction });
      }

      const uniqueIdx = 'vendors_company_id_key';
      if (!(await indexExists(uniqueIdx))) {
        await queryInterface.addIndex('vendors', {
          fields: ['companyId'],
          name: uniqueIdx,
          unique: true,
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to rollback vendors.companyId index migration:', error.message);
      throw error;
    }
  }
};
