'use strict';

/**
 * Add unique composite indexes for invoice/po numbers per company:
 * - purchase_invoices: (invoice_number, companyId)
 * - purchase_orders: (po_number, companyId)
 *
 * This migration checks for existing duplicates and will fail with a clear message
 * if duplicates exist so they can be resolved before applying the unique constraint.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const indexExists = async (table, indexName) => {
        const res = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${table}' AND indexname = '${indexName}'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        return res && res.length > 0;
      };

      // purchase_invoices: invoice_number + companyId
      const invIndex = 'purchase_invoices_invoice_number_companyid_idx';
      if (!(await indexExists('purchase_invoices', invIndex))) {
        // Check duplicates
        const dupInv = await queryInterface.sequelize.query(
          `SELECT invoice_number, "companyId", COUNT(*) as cnt FROM purchase_invoices WHERE invoice_number IS NOT NULL GROUP BY invoice_number, "companyId" HAVING COUNT(*) > 1`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        if (dupInv && dupInv.length > 0) {
          console.error('Cannot create unique index on purchase_invoices(invoice_number, companyId): duplicates found', dupInv[0]);
          throw new Error('Duplicate invoice_number values exist per company. Resolve duplicates before running this migration.');
        }

        await queryInterface.addIndex('purchase_invoices', {
          fields: ['invoice_number', 'companyId'],
          name: invIndex,
          unique: true,
          transaction
        });
      }

      // purchase_orders: po_number + companyId
      const poIndex = 'purchase_orders_po_number_companyid_idx';
      if (!(await indexExists('purchase_orders', poIndex))) {
        const dupPo = await queryInterface.sequelize.query(
          `SELECT po_number, "companyId", COUNT(*) as cnt FROM purchase_orders WHERE po_number IS NOT NULL GROUP BY po_number, "companyId" HAVING COUNT(*) > 1`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        if (dupPo && dupPo.length > 0) {
          console.error('Cannot create unique index on purchase_orders(po_number, companyId): duplicates found', dupPo[0]);
          throw new Error('Duplicate po_number values exist per company. Resolve duplicates before running this migration.');
        }

        await queryInterface.addIndex('purchase_orders', {
          fields: ['po_number', 'companyId'],
          name: poIndex,
          unique: true,
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to add unique invoice/po number indexes:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const dropIfExists = async (table, indexName) => {
        const res = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${table}' AND indexname = '${indexName}'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );
        if (res && res.length > 0) {
          await queryInterface.removeIndex(table, indexName, { transaction });
        }
      };

      await dropIfExists('purchase_invoices', 'purchase_invoices_invoice_number_companyid_idx');
      await dropIfExists('purchase_orders', 'purchase_orders_po_number_companyid_idx');

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error('Failed to remove unique invoice/po number indexes:', error.message);
      throw error;
    }
  }
};
