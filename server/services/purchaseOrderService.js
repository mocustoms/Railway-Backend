const { PurchaseOrder, PurchaseOrderItem, ProductStore, Product, sequelize } = require('../models');

class PurchaseOrderService {
  static async createPurchaseOrder(payload, user) {
    return await sequelize.transaction(async (transaction) => {
      const items = payload.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        const err = new Error('At least one item is required');
        err.status = 400;
        throw err;
      }

      let subtotal = 0;
      let totalTax = 0;
      let totalDiscount = 0;

      const itemRecords = [];
      for (const it of items) {
        const qty = Number(it.quantityOrdered || it.quantity_ordered || 0);
        const unitPrice = Number(it.unitPrice || it.unit_price || 0);
        const discountPercentage = Number(it.discountPercentage || it.discount_percentage || 0) || 0;
        const discountAmount = Number(it.discountAmount || it.discount_amount || 0) || 0;
        const taxPercentage = Number(it.taxPercentage || it.tax_percentage || 0) || 0;

        const lineSubtotal = +(qty * unitPrice).toFixed(2);
        const computedDiscount = discountAmount || +(lineSubtotal * (discountPercentage / 100)).toFixed(2);
        const taxable = +(lineSubtotal - computedDiscount).toFixed(2);
        const computedTax = +(taxPercentage ? (taxable * (taxPercentage / 100)) : 0).toFixed(2);
        const lineTotal = +(taxable + computedTax).toFixed(2);

        subtotal += Number(lineSubtotal);
        totalDiscount += Number(computedDiscount);
        totalTax += Number(computedTax);

        itemRecords.push({
          product_id: it.productId || it.product_id,
          quantity_ordered: qty,
          quantity_received: 0,
          unit_price: unitPrice,
          discount_percentage: discountPercentage || null,
          discount_amount: computedDiscount || null,
          tax_percentage: taxPercentage || null,
          tax_amount: computedTax || null,
          line_subtotal: lineSubtotal,
          line_total: lineTotal,
          notes: it.notes || null
        });
      }

      const shipping = Number(payload.shippingCost || payload.shipping_cost || 0) || 0;
      const total = +(subtotal + totalTax + shipping - totalDiscount).toFixed(2);

      const po = await PurchaseOrder.create({
        po_number: payload.poNumber || payload.po_number || null,
        order_date: payload.orderDate || payload.order_date,
        expected_delivery_date: payload.expectedDeliveryDate || payload.expected_delivery_date || null,
        vendor_id: payload.vendorId || payload.vendor_id,
        store_id: payload.storeId || payload.store_id,
        currency_id: payload.currencyId || payload.currency_id || null,
        exchange_rate: payload.exchangeRate || payload.exchange_rate || 1,
        shipping_cost: shipping,
        subtotal_amount: subtotal,
        tax_amount: totalTax,
        discount_amount: totalDiscount,
        total_amount: total,
        status: payload.status || 'draft',
        notes: payload.notes || null,
        created_by: user.id,
        companyId: payload.companyId
      }, { transaction });

      for (const rec of itemRecords) {
        await PurchaseOrderItem.create({
          purchase_order_id: po.id,
          product_id: rec.product_id,
          quantity_ordered: rec.quantity_ordered,
          quantity_received: rec.quantity_received,
          unit_price: rec.unit_price,
          discount_percentage: rec.discount_percentage,
          discount_amount: rec.discount_amount,
          tax_percentage: rec.tax_percentage,
          tax_amount: rec.tax_amount,
          line_subtotal: rec.line_subtotal,
          line_total: rec.line_total,
          notes: rec.notes,
        }, { transaction });
      }

      return await PurchaseOrder.findByPk(po.id, { include: [{ model: PurchaseOrderItem, as: 'items' }], transaction });
    });
  }

  static async getById(id, companyId) {
    return await PurchaseOrder.findOne({ where: { id, companyId }, include: [{ model: PurchaseOrderItem, as: 'items' }] });
  }

  static async list(filters = {}) {
    const where = {};
    if (filters.storeId) where.store_id = filters.storeId;
    if (filters.vendorId) where.vendor_id = filters.vendorId;
    if (filters.status) where.status = filters.status;
    if (filters.companyId) where.companyId = filters.companyId;
    return await PurchaseOrder.findAll({ where, include: [{ model: PurchaseOrderItem, as: 'items' }], order: [['order_date','DESC']] });
  }

  static async updatePurchaseOrder(id, updates, user) {
    return await sequelize.transaction(async (transaction) => {
      const po = await PurchaseOrder.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!po) {
        const err = new Error('Purchase order not found'); err.status = 404; throw err;
      }
      // prevent updates when cancelled or received
      if (['received','cancelled'].includes(po.status)) {
        const err = new Error('Cannot modify a received or cancelled purchase order'); err.status = 400; throw err;
      }

      // Only allow certain header updates; items editing is out of scope here
      const allowed = ['order_date','expected_delivery_date','vendor_id','store_id','currency_id','exchange_rate','shipping_cost','notes','status','po_number'];
      const cleaned = {};
      for (const k of Object.keys(updates)) {
        if (allowed.includes(k)) cleaned[k] = updates[k];
      }
      cleaned.updated_by = user.id;
      await po.update(cleaned, { transaction });
      return await PurchaseOrder.findByPk(id, { include: [{ model: PurchaseOrderItem, as: 'items' }], transaction });
    });
  }

  static async receive(id, receivePayload, user) {
    return await sequelize.transaction(async (transaction) => {
      const po = await PurchaseOrder.findByPk(id, { include: [{ model: PurchaseOrderItem, as: 'items' }], transaction, lock: transaction.LOCK.UPDATE });
      if (!po) { const err = new Error('Purchase order not found'); err.status = 404; throw err; }
      if (po.status === 'cancelled') { const err = new Error('Cannot receive a cancelled purchase order'); err.status = 400; throw err; }

      // receivePayload.items = [{ id: purchaseOrderItemId, quantity: qtyReceived }]
      const itemsById = {};
      for (const it of receivePayload.items || []) itemsById[it.id || it.itemId || it.item_id] = it.quantity || it.quantity_received || it.qty || 0;

      for (const item of po.items) {
        const toReceive = Number(itemsById[item.id] || 0);
        if (!toReceive) continue;
        const newReceived = +(Number(item.quantity_received) + toReceive).toFixed(3);
        // cap at ordered amount
        const qtyOrdered = Number(item.quantity_ordered || item.quantityOrdered || 0);
        const finalReceived = Math.min(newReceived, qtyOrdered);
        await PurchaseOrderItem.update({ quantity_received: finalReceived }, { where: { id: item.id }, transaction });

        // update product store quantity
        const productStore = await ProductStore.findOne({ where: { product_id: item.product_id, store_id: po.store_id, companyId: po.companyId }, transaction });
        if (productStore) {
          const newQty = +(Number(productStore.quantity) + (finalReceived - Number(item.quantity_received || 0))).toFixed(3);
          await productStore.update({ quantity: newQty, last_updated: new Date() }, { transaction });
        } else {
          await ProductStore.create({ product_id: item.product_id, store_id: po.store_id, quantity: finalReceived, is_active: true, assigned_by: user.id, assigned_at: new Date(), companyId: po.companyId }, { transaction });
        }
      }

      // reload items and set status
      const refreshedItems = await PurchaseOrderItem.findAll({ where: { purchase_order_id: po.id }, transaction });
      let allReceived = true;
      for (const it of refreshedItems) {
        if (Number(it.quantity_received) < Number(it.quantity_ordered)) { allReceived = false; break; }
      }
      const newStatus = allReceived ? 'received' : 'partially_received';
      await po.update({ status: newStatus, updated_by: user.id }, { transaction });

      return await PurchaseOrder.findByPk(po.id, { include: [{ model: PurchaseOrderItem, as: 'items' }], transaction });
    });
  }

  static async cancel(id, user) {
    return await sequelize.transaction(async (transaction) => {
      const po = await PurchaseOrder.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!po) { const err = new Error('Purchase order not found'); err.status = 404; throw err; }
      if (po.status === 'received') { const err = new Error('Cannot cancel a fully received purchase order'); err.status = 400; throw err; }
      await po.update({ status: 'cancelled', updated_by: user.id }, { transaction });
      return po;
    });
  }
}

module.exports = PurchaseOrderService;
