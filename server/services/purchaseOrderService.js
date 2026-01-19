const {
  PurchaseOrder,
  PurchaseOrderItem,
  ProductStore,
  Product,
  sequelize,
} = require("../models");

class PurchaseOrderService {
  static async createPurchaseOrder(payload, user) {
    return await sequelize.transaction(async (transaction) => {
      const items = payload.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        const err = new Error("At least one item is required");
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
        const discountPercentage = Number(
          it.discountPercentage || it.discount_percentage || 0,
        );
        const discountAmount = Number(
          it.discountAmount || it.discount_amount || 0,
        );
        const taxPercentage = Number(
          it.taxPercentage || it.tax_percentage || 0,
        );

        // basic validation
        if (isNaN(qty) || qty <= 0) {
          const err = new Error("Item quantity must be a positive number");
          err.status = 400;
          throw err;
        }
        if (isNaN(unitPrice) || unitPrice < 0) {
          const err = new Error(
            "Item unit price must be a non-negative number",
          );
          err.status = 400;
          throw err;
        }

        const lineSubtotal = +(qty * unitPrice).toFixed(2);
        const computedDiscount =
          !isNaN(discountAmount) && discountAmount > 0
            ? discountAmount
            : +(lineSubtotal * (discountPercentage / 100)).toFixed(2);
        const taxable = +(lineSubtotal - computedDiscount).toFixed(2);
        const computedTax = +(
          taxPercentage ? taxable * (taxPercentage / 100) : 0
        ).toFixed(2);
        const lineTotal = +(taxable + computedTax).toFixed(2);

        subtotal += Number(lineSubtotal);
        totalDiscount += Number(computedDiscount);
        totalTax += Number(computedTax);

        itemRecords.push({
          product_id: it.productId || it.product_id,
          quantity_ordered: qty,
          quantity_received: 0,
          unit_price: unitPrice,
          // preserve zero values explicitly (don't coerce to null)
          discount_percentage: isNaN(discountPercentage)
            ? null
            : discountPercentage,
          discount_amount: computedDiscount,
          tax_percentage: isNaN(taxPercentage) ? null : taxPercentage,
          tax_amount: computedTax,
          line_subtotal: lineSubtotal,
          line_total: lineTotal,
          notes: it.notes || null,
        });
      }

      const shipping =
        Number(payload.shippingCost || payload.shipping_cost || 0) || 0;
      const total = +(subtotal + totalTax + shipping - totalDiscount).toFixed(
        2,
      );

      const po = await PurchaseOrder.create(
        {
          poNumber: payload.poNumber || payload.po_number || null,
          orderDate:
            payload.orderDate ||
            payload.order_date ||
            payload.purchasing_order_date,
          expectedDeliveryDate:
            payload.expectedDeliveryDate ||
            payload.expected_delivery_date ||
            payload.valid_until ||
            null,
          vendorId: payload.vendorId || payload.vendor_id,
          storeId: payload.storeId || payload.store_id,
          currencyId: payload.currencyId || payload.currency_id || null,
          exchangeRate: payload.exchangeRate || payload.exchange_rate || 1,
          shippingCost: shipping,
          subtotalAmount: subtotal,
          taxAmount: totalTax,
          discountAmount: totalDiscount,
          totalAmount: total,
          status: payload.status || "draft",
          notes: payload.notes || null,
          createdBy: user.id,
          companyId: payload.companyId,
        },
        { transaction },
      );

      for (const rec of itemRecords) {
        await PurchaseOrderItem.create(
          {
            purchaseOrderId: po.id,
            productId: rec.product_id,
            quantityOrdered: rec.quantity_ordered,
            quantityReceived: rec.quantity_received,
            unitPrice: rec.unit_price,
            discountPercentage: rec.discount_percentage,
            discountAmount: rec.discount_amount,
            taxPercentage: rec.tax_percentage,
            taxAmount: rec.tax_amount,
            lineSubtotal: rec.line_subtotal,
            lineTotal: rec.line_total,
            notes: rec.notes,
          },
          { transaction },
        );
      }

      return await PurchaseOrder.findByPk(po.id, {
        include: [{ model: PurchaseOrderItem, as: "items" }],
        transaction,
      });
    });
  }

  static async getById(id, companyId) {
    return await PurchaseOrder.findOne({
      where: { id, companyId },
      include: [{ model: PurchaseOrderItem, as: "items" }],
    });
  }

  static async list(filters = {}) {
    const where = {};
    if (filters.storeId) where.store_id = filters.storeId;
    if (filters.vendorId) where.vendor_id = filters.vendorId;
    if (filters.status) where.status = filters.status;
    if (filters.companyId) where.companyId = filters.companyId;
    return await PurchaseOrder.findAll({
      where,
      include: [{ model: PurchaseOrderItem, as: "items" }],
      order: [["order_date", "DESC"]],
    });
  }

  static async updatePurchaseOrder(id, updates, user) {
    return await sequelize.transaction(async (transaction) => {
      const po = await PurchaseOrder.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!po) {
        const err = new Error("Purchase order not found");
        err.status = 404;
        throw err;
      }
      // prevent updates when cancelled or received
      if (["received", "cancelled"].includes(po.status)) {
        const err = new Error(
          "Cannot modify a received or cancelled purchase order",
        );
        err.status = 400;
        throw err;
      }

      // Only allow certain header updates; items editing is out of scope here
      const allowed = [
        "order_date",
        "expected_delivery_date",
        "vendor_id",
        "store_id",
        "currency_id",
        "exchange_rate",
        "shipping_cost",
        "notes",
        "status",
        "po_number",
      ];
      const cleaned = {};
      for (const k of Object.keys(updates)) {
        if (allowed.includes(k)) cleaned[k] = updates[k];
      }
      cleaned.updated_by = user.id;
      await po.update(cleaned, { transaction });
      return await PurchaseOrder.findByPk(id, {
        include: [{ model: PurchaseOrderItem, as: "items" }],
        transaction,
      });
    });
  }

  static async receive(id, receivePayload, user) {
    return await sequelize.transaction(async (transaction) => {
      // Lock the purchase order row only (avoid FOR UPDATE on LEFT JOIN which fails in Postgres)
      // Fetch the parent row with FOR UPDATE, then load items in a separate query.
      const po = await PurchaseOrder.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      // Load items separately (no FOR UPDATE on outer join)
      const poWithItems = await PurchaseOrder.findByPk(id, { include: [{ model: PurchaseOrderItem, as: "items" }], transaction });
      // use poWithItems for items access below
      po.items = poWithItems ? poWithItems.items : [];
      if (!po) {
        const err = new Error("Purchase order not found");
        err.status = 404;
        throw err;
      }
      if (po.status === "cancelled") {
        const err = new Error("Cannot receive a cancelled purchase order");
        err.status = 400;
        throw err;
      }

      // receivePayload.items = [{ id: purchaseOrderItemId, quantity: qtyReceived }]
      const itemsById = {};
      for (const it of receivePayload.items || [])
        itemsById[it.id || it.itemId || it.item_id] =
          it.quantity || it.quantity_received || it.qty || 0;

      for (const item of po.items) {
        const toReceive = Number(itemsById[item.id] || 0);
        if (!toReceive) continue;
        const newReceived = +(
          Number(item.quantityReceived || item.quantity_received || 0) +
          toReceive
        ).toFixed(3);
        // cap at ordered amount
        const qtyOrdered = Number(
          item.quantity_ordered || item.quantityOrdered || 0,
        );
        const finalReceived = Math.min(newReceived, qtyOrdered);
        await PurchaseOrderItem.update(
          { quantityReceived: finalReceived },
          { where: { id: item.id }, transaction },
        );

        // update product store quantity
        // ProductStore model fields are defined in snake_case (product_id, store_id) so map accordingly
        const productStore = await ProductStore.findOne({
          where: {
            product_id: item.productId,
            store_id: po.storeId,
            companyId: po.companyId,
          },
          transaction,
        });
        if (productStore) {
          const newQty = +(
            Number(productStore.quantity) +
            (finalReceived - Number(item.quantityReceived || 0))
          ).toFixed(3);
          await productStore.update(
            { quantity: newQty, last_updated: new Date() },
            { transaction },
          );
        } else {
          await ProductStore.create(
            {
              product_id: item.productId,
              store_id: po.storeId,
              quantity: finalReceived,
              is_active: true,
              assigned_by: user.id,
              assigned_at: new Date(),
              companyId: po.companyId,
            },
            { transaction },
          );
        }
      }

      // reload items and set status
      const refreshedItems = await PurchaseOrderItem.findAll({
        where: { purchaseOrderId: po.id },
        transaction,
      });
      let allReceived = true;
      for (const it of refreshedItems) {
        if (Number(it.quantityReceived) < Number(it.quantityOrdered)) {
          allReceived = false;
          break;
        }
      }
      const newStatus = "received";
      await po.update(
        { status: newStatus, updatedBy: user.id },
        { transaction },
      );

      return await PurchaseOrder.findByPk(po.id, {
        include: [{ model: PurchaseOrderItem, as: "items" }],
        transaction,
      });
    });
  }

  static async cancel(id, user) {
    return await sequelize.transaction(async (transaction) => {
      const po = await PurchaseOrder.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!po) {
        const err = new Error("Purchase order not found");
        err.status = 404;
        throw err;
      }
      if (po.status === "received") {
        const err = new Error("Cannot cancel a fully received purchase order");
        err.status = 400;
        throw err;
      }
      await po.update(
        { status: "cancelled", updatedBy: user.id },
        { transaction },
      );
      return po;
    });
  }
}

module.exports = PurchaseOrderService;
