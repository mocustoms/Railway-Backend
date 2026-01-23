const { PurchaseInvoice, PurchaseInvoiceItem, PurchaseInvoicePayment, sequelize } = require('../models');

class PurchaseInvoiceService {
  static async createInvoice(payload, user) {
    return await sequelize.transaction(async (transaction) => {
      const items = payload.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        const err = new Error('At least one item is required'); err.status = 400; throw err;
      }

      let subtotal = 0; let totalTax = 0; let totalDiscount = 0;
      const itemRecords = [];
      for (const it of items) {
        const qty = Number(it.quantity || it.qty || 0);
        const unitPrice = Number(it.unitPrice || it.unit_price || 0);
        const discountPercentage = Number(it.discountPercentage || it.discount_percentage || 0) || 0;
        const discountAmount = Number(it.discountAmount || it.discount_amount || 0) || 0;
        const taxPercentage = Number(it.taxPercentage || it.tax_percentage || 0) || 0;

        const lineSubtotal = +(qty * unitPrice).toFixed(2);
        const computedDiscount = discountAmount || +(lineSubtotal * (discountPercentage/100)).toFixed(2);
        const taxable = +(lineSubtotal - computedDiscount).toFixed(2);
        const computedTax = +(taxPercentage ? (taxable * (taxPercentage/100)) : 0).toFixed(2);
        const lineTotal = +(taxable + computedTax).toFixed(2);

        subtotal += Number(lineSubtotal);
        totalDiscount += Number(computedDiscount);
        totalTax += Number(computedTax);

        itemRecords.push({
          product_id: it.productId || it.product_id || null,
          description: it.description || it.desc || null,
          quantity: qty,
          unitPrice: unitPrice,
          discount_percentage: discountPercentage || null,
          discount_amount: computedDiscount || null,
          tax_percentage: taxPercentage || null,
          tax_amount: computedTax || null,
          line_subtotal: lineSubtotal,
          line_total: lineTotal
        });
      }

      const shipping = Number(payload.shippingCost || payload.shipping_cost || 0) || 0;
      const total = +(subtotal + totalTax + shipping - totalDiscount).toFixed(2);

      const invoice = await PurchaseInvoice.create({
        invoice_number: payload.invoiceNumber || payload.invoice_number || null,
        invoiceDate: payload.invoiceDate || payload.invoice_date,
        due_date: payload.dueDate || payload.due_date || null,
        vendorId: payload.vendorId || payload.vendor_id,
        store_id: payload.storeId || payload.store_id || null,
        purchase_order_id: payload.purchaseOrderId || payload.purchase_order_id || null,
        currency_id: payload.currencyId || payload.currency_id || null,
        exchange_rate: payload.exchangeRate || payload.exchange_rate || 1,
        reference: payload.reference || null,
        status: payload.status || 'draft',
        subtotal_amount: subtotal,
        discount_amount: totalDiscount,
        tax_amount: totalTax,
        shipping_cost: shipping,
        total_amount: total,
        balance_due: total,
        notes: payload.notes || null,
        createdBy: user.id,
        companyId: payload.companyId
      }, { transaction });

      for (const rec of itemRecords) {
        await PurchaseInvoiceItem.create({ purchaseInvoiceId: invoice.id, ...rec }, { transaction });
      }

      return await PurchaseInvoice.findByPk(invoice.id, { include: [{ model: PurchaseInvoiceItem, as: 'items' }], transaction });
    });
  }

  static async getById(id, companyId) {
    return await PurchaseInvoice.findOne({ where: { id, companyId }, include: [{ model: PurchaseInvoiceItem, as: 'items' }, { model: PurchaseInvoicePayment, as: 'payments' }] });
  }

  static async list(filters = {}) {
    const where = {};
    if (filters.vendorId) where.vendor_id = filters.vendorId;
    if (filters.status) where.status = filters.status;
    if (filters.companyId) where.companyId = filters.companyId;
    return await PurchaseInvoice.findAll({ where, include: [{ model: PurchaseInvoiceItem, as: 'items' }, { model: PurchaseInvoicePayment, as: 'payments' }], order: [['invoice_date','DESC']] });
  }

  static async post(id, user) {
    return await sequelize.transaction(async (transaction) => {
      const invoice = await PurchaseInvoice.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!invoice) { const err = new Error('Invoice not found'); err.status = 404; throw err; }
      if (invoice.status !== 'draft') { const err = new Error('Only draft invoices can be posted'); err.status = 400; throw err; }
      await invoice.update({ status: 'posted', updated_by: user.id }, { transaction });
      return invoice;
    });
  }

  static async pay(id, payload, user) {
    return await sequelize.transaction(async (transaction) => {
      const invoice = await PurchaseInvoice.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!invoice) { const err = new Error('Invoice not found'); err.status = 404; throw err; }
      if (invoice.status === 'cancelled') { const err = new Error('Cannot pay a cancelled invoice'); err.status = 400; throw err; }
      const amount = Number(payload.amount || 0);
      if (amount <= 0) { const err = new Error('Payment amount must be > 0'); err.status = 400; throw err; }

      await PurchaseInvoicePayment.create({ purchase_invoice_id: id, amount, method: payload.method || null, reference: payload.reference || null, created_by: user.id }, { transaction });

      const newBalance = +(Number(invoice.balance_due) - amount).toFixed(2);
      let newStatus = invoice.status;
      if (newBalance <= 0) newStatus = 'paid';
      else if (newBalance < Number(invoice.total_amount)) newStatus = 'partially_paid';

      await invoice.update({ balance_due: Math.max(0, newBalance), status: newStatus, updated_by: user.id }, { transaction });
      return await PurchaseInvoice.findByPk(id, { include: [{ model: PurchaseInvoicePayment, as: 'payments' }, { model: PurchaseInvoiceItem, as: 'items' }], transaction });
    });
  }

  static async cancel(id, user) {
    return await sequelize.transaction(async (transaction) => {
      const invoice = await PurchaseInvoice.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!invoice) { const err = new Error('Invoice not found'); err.status = 404; throw err; }
      if (invoice.status === 'paid') { const err = new Error('Cannot cancel a paid invoice'); err.status = 400; throw err; }
      await invoice.update({ status: 'cancelled', updated_by: user.id }, { transaction });
      return invoice;
    });
  }
}

module.exports = PurchaseInvoiceService;
