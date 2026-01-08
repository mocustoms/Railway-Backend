'use strict';

/**
 * Remove unique index on vendors.vendor_group_id which prevents multiple vendors per group
 * and replace it with a non-unique index for performance.
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

      const uniqueIdx = 'vendors_vendor_group_id_key';
      if (await indexExists(uniqueIdx)) {
        await queryInterface.removeIndex('vendors', uniqueIdx, { transaction });
      }

      // Add a non-unique index for vendor_group_id if not exists
      const nonUniqueIdx = 'vendors_vendor_group_id_idx';
      if (!(await indexExists(nonUniqueIdx))) {
        await queryInterface.addIndex('vendors', {
          fields: ['vendor_group_id'],
          name: nonUniqueIdx,
          unique: false,
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to modify vendors.vendor_group_id index:', error.message);
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

      const nonUniqueIdx = 'vendors_vendor_group_id_idx';
      if (await indexExists(nonUniqueIdx)) {
        await queryInterface.removeIndex('vendors', nonUniqueIdx, { transaction });
      }

      // Recreate unique index (may fail if duplicate vendor_group_id values exist)
      const uniqueIdx = 'vendors_vendor_group_id_key';
      if (!(await indexExists(uniqueIdx))) {
        await queryInterface.addIndex('vendors', {
          fields: ['vendor_group_id'],
          name: uniqueIdx,
          unique: true,
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to rollback vendors vendor_group_id index migration:', error.message);
      throw error;
    }
  }
};
