"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Drop any existing indexes that reference the camelCase column name (transactionTypeId)
      const [[rows]] = await queryInterface.sequelize.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'openingBalances' AND indexdef ILIKE '%transactionTypeId%';",
        { transaction }
      );

      // rows may be undefined if no results; normalize
      const indexNames = Array.isArray(rows) ? rows.map(r => r.indexname) : [];
      for (const idx of indexNames) {
        await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${idx}";`, { transaction });
      }

      // Create an index on the snake_case column used by the DB and associations
      // Use IF NOT EXISTS style via raw query for portability across versions
      await queryInterface.addIndex('openingBalances', ['transaction_type_id'], {
        name: 'openingBalances_transaction_type_id_idx',
        transaction
      });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Remove the index we created
      await queryInterface.removeIndex('openingBalances', 'openingBalances_transaction_type_id_idx', { transaction }).catch(() => {});

      // If the camelCase column exists (unlikely), recreate an index that references it
      const [[colExists]] = await queryInterface.sequelize.query(
        "SELECT 1 as ok FROM information_schema.columns WHERE table_name = 'openingBalances' AND column_name = 'transactionTypeId';",
        { transaction }
      );
      if (Array.isArray(colExists) ? colExists.length > 0 : colExists) {
        // create index on camelCase column (only if column exists)
        await queryInterface.addIndex('openingBalances', ['transactionTypeId'], {
          name: 'openingBalances_transactionTypeId_idx',
          transaction
        });
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
