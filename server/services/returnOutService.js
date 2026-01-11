const { ReturnOut, ReturnOutItem, ProductStore, Product, sequelize } = require('../models');

class ReturnOutService {
  static async createReturnOut(data, user) {
    return await sequelize.transaction(async (transaction) => {
      // compute totals and create ReturnOut
      const items = data.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        const err = new Error('At least one item is required');
        err.status = 400;
        throw err;
      }

      // compute line totals and refund amounts
      let totalAmount = 0;
      const itemRecords = [];

      for (const it of items) {
        const quantity = Number(it.quantity) || 0;
        const unitPrice = Number(it.unitPrice || it.unit_price || 0) || 0;
        const discountPercentage = Number(it.discountPercentage || it.discount_percentage || 0) || 0;
        const discountAmount = Number(it.discountAmount || it.discount_amount || 0) || 0;
        const taxPercentage = Number(it.taxPercentage || it.tax_percentage || 0) || 0;

        const computedDiscountAmount = discountAmount || (unitPrice * quantity * (discountPercentage / 100));
        const taxable = unitPrice * quantity - computedDiscountAmount;
        const computedTax = taxPercentage ? (taxable * (taxPercentage / 100)) : 0;
        const refundAmount = Number(it.refundAmount || it.refund_amount) || (taxable + computedTax);
        const lineTotal = refundAmount;

        totalAmount += Number(lineTotal);

        itemRecords.push({
          product_id: it.productId || it.product_id,
          quantity,
          unit_price: unitPrice,
          discount_percentage: discountPercentage || null,
          discount_amount: computedDiscountAmount || null,
          tax_percentage: taxPercentage || null,
          tax_amount: computedTax || null,
          refund_amount: refundAmount,
          line_total: lineTotal
        });
      }

      const returnOut = await ReturnOut.create({
        return_date: data.returnDate || data.return_date || new Date(),
        store_id: data.storeId || data.store_id,
        vendor_id: data.vendorId || data.vendor_id || null,
        return_reason_id: data.returnReasonId || data.return_reason_id || null,
        currency_id: data.currencyId || data.currency_id || null,
        exchange_rate: data.exchangeRate || data.exchange_rate || 1,
        notes: data.notes || null,
        total_amount: totalAmount,
        status: data.status || 'draft',
        created_by: user.id,
        companyId: data.companyId
      }, { transaction });

      // create items and update product store quantities
      for (const rec of itemRecords) {
        const item = await ReturnOutItem.create({
          return_out_id: returnOut.id,
          product_id: rec.product_id,
          quantity: rec.quantity,
          unit_price: rec.unit_price,
          discount_percentage: rec.discount_percentage,
          discount_amount: rec.discount_amount,
          tax_percentage: rec.tax_percentage,
          tax_amount: rec.tax_amount,
          refund_amount: rec.refund_amount,
          line_total: rec.line_total,
          companyId: data.companyId
        }, { transaction });

        // decrement product store quantity for the given store
        const productStore = await ProductStore.findOne({
          where: { product_id: rec.product_id, store_id: returnOut.store_id, companyId: data.companyId },
          transaction
        });

        if (productStore) {
          const newQty = Number(productStore.quantity) - Number(rec.quantity || 0);
          await productStore.update({ quantity: newQty, last_updated: new Date() }, { transaction });
        } else {
          // create product store record with negative quantity (or zero) as business decision
          await ProductStore.create({
            product_id: rec.product_id,
            store_id: returnOut.store_id,
            quantity: Math.max(0, -rec.quantity),
            is_active: true,
            assigned_by: user.id,
            assigned_at: new Date(),
            companyId: data.companyId
          }, { transaction });
        }
      }

      return await ReturnOut.findByPk(returnOut.id, { include: [{ model: ReturnOutItem, as: 'items' }], transaction });
    });
  }

  static async getById(id, companyId) {
    return await ReturnOut.findOne({ where: { id, companyId }, include: [{ model: ReturnOutItem, as: 'items' }] });
  }

  static async list(filters = {}) {
    const where = {};
    if (filters.storeId) where.store_id = filters.storeId;
    if (filters.vendorId) where.vendor_id = filters.vendorId;
    if (filters.status) where.status = filters.status;
    if (filters.companyId) where.companyId = filters.companyId;
    return await ReturnOut.findAll({ where, include: [{ model: ReturnOutItem, as: 'items' }], order: [['return_date','DESC']] });
  }
}

module.exports = ReturnOutService;
