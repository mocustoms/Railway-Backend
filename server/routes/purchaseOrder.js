const express = require("express");
const router = express.Router();
const { body, param, validationResult } = require("express-validator");
const auth = require("../middleware/auth");
const stripCompanyId = require("../middleware/stripCompanyId");
const {
  companyFilter,
  buildCompanyWhere,
} = require("../middleware/companyFilter");
const { csrfProtection } = require("../middleware/csrfProtection");
const { Op } = require("sequelize");
const {
  PurchaseOrder,
  PurchaseOrderItem,
  Product,
  Store,
  Vendor,
  Currency,
  User,
} = require("../models");
const PurchaseOrderService = require("../services/purchaseOrderService");
const { sequelize } = require("../models");

const validate = (validations) => async (req, res, next) => {
  await Promise.all(validations.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array() });
  next();
};

router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId);

// Get purchase order statistics
router.get("/stats", async (req, res) => {
  try {
    const total = await PurchaseOrder.count({ where: buildCompanyWhere(req) });
    const draft = await PurchaseOrder.count({
      where: buildCompanyWhere(req, { status: "draft" }),
    });
    const sent = await PurchaseOrder.count({
      where: buildCompanyWhere(req, { status: "sent" }),
    });
    const accepted = await PurchaseOrder.count({
      where: buildCompanyWhere(req, { status: "accepted" }),
    });
    // const received = await PurchaseOrder.count({
    //   where: buildCompanyWhere(req, { status: "received" }),
    // });
    // const cancelled = await PurchaseOrder.count({
    //   where: buildCompanyWhere(req, { status: "cancelled" }),
    // });

    // Sum total_amount for all purchase orders in company
    const totalAmountSum =
      (await PurchaseOrder.sum("total_amount", {
        where: buildCompanyWhere(req),
      })) || 0;

    res.json({
      total,
      draft,
      sent,
      accepted,
      totalValue: totalAmountSum,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

router.post(
  "/",
  csrfProtection,
  validate([
    // Expect snake_case payload as provided in the example
    body("purchasing_order_date")
      .notEmpty()
      .withMessage("purchasing_order_date is required"),
    body("vendor_id").notEmpty().withMessage("vendor_id is required"),
    body("store_id").notEmpty().withMessage("store_id is required"),
    body("items").isArray({ min: 1 }).withMessage("items array required"),
    body("items.*.product_id")
      .notEmpty()
      .withMessage("product_id is required for item"),
    body("items.*.quantity")
      .notEmpty()
      .withMessage("quantity is required for item"),
    body("items.*.unit_price")
      .notEmpty()
      .withMessage("unit_price is required for item"),
  ]),
  async (req, res) => {
    try {
      if (!req.user.companyId)
        return res.status(400).json({ error: "Company ID is required" });

      // Map incoming snake_case payload to the keys expected by the service
      const incoming = req.body || {};
      console.log("Incoming PO payload:", incoming);
      const mapped = {
        // header fields: prefer standard names the service understands
        poNumber:
          incoming.purchasing_order_ref_number || incoming.poNumber || null,
        order_date:
          incoming.purchasing_order_date ||
          incoming.order_date ||
          incoming.orderDate,
        expected_delivery_date:
          incoming.valid_until ||
          incoming.expected_delivery_date ||
          incoming.expectedDeliveryDate ||
          null,
        vendor_id: incoming.vendor_id || incoming.vendorId,
        store_id: incoming.store_id || incoming.storeId,
        currency_id: incoming.currency_id || incoming.currencyId || null,
        exchange_rate: incoming.exchange_rate || incoming.exchangeRate || 1,
        shipping_cost: incoming.shipping_cost || incoming.shippingCost || 0,
        notes: incoming.notes || null,
        terms_conditions:
          incoming.terms_conditions || incoming.termsConditions || null,
        // keep other metadata the client may send
        system_default_currency_id: incoming.system_default_currency_id || null,
        exchange_rate_id: incoming.exchange_rate_id || null,
        price_category_id: incoming.price_category_id || null,
        // items will be normalized below
        items: [],
        companyId: req.user.companyId,
      };

      // Normalize items: map quantity -> quantity_ordered, preserve pricing fields
      for (const it of incoming.items || []) {
        mapped.items.push({
          productId: it.product_id || it.productId,
          product_id: it.product_id || it.productId,
          quantity_ordered: Number(
            it.quantity || it.quantity_ordered || it.quantityOrdered || 0,
          ),
          quantity: Number(
            it.quantity || it.quantity_ordered || it.quantityOrdered || 0,
          ),
          unit_price: Number(it.unit_price || it.unitPrice || 0),
          unitPrice: Number(it.unit_price || it.unitPrice || 0),
          discount_percentage:
            it.discount_percentage || it.discountPercentage || 0,
          discount_amount: it.discount_amount || it.discountAmount || 0,
          tax_percentage: it.tax_percentage || it.taxPercentage || 0,
          tax_amount: it.tax_amount || it.taxAmount || 0,
          purchases_tax_id: it.purchases_tax_id || it.purchasesTaxId || null,
          wht_tax_id: it.wht_tax_id || it.whtTaxId || null,
          wht_amount: it.wht_amount || it.whtAmount || 0,
          currency_id: it.currency_id || null,
          exchange_rate: it.exchange_rate || 1,
          equivalent_amount: it.equivalent_amount || null,
          amount_after_discount: it.amount_after_discount || null,
          amount_after_wht: it.amount_after_wht || null,
          line_total: it.line_total || null,
          price_tax_inclusive: it.price_tax_inclusive || false,
          notes: it.notes || null,
          serial_numbers: Array.isArray(it.serial_numbers)
            ? it.serial_numbers
            : [],
          batch_number: it.batch_number || null,
          expiry_date: it.expiry_date || null,
        });
      }

      const created = await PurchaseOrderService.createPurchaseOrder(
        mapped,
        req.user,
      );
      res.status(201).json(created);
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      if (error.name === "SequelizeForeignKeyConstraintError")
        return res.status(400).json({ error: "Invalid reference ID" });
      res
        .status(500)
        .json({ error: "Internal server error", details: error.message });
    }
  },
);

// List with pagination/search/sort
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const sortBy = req.query.sortBy || "order_date";
    const sortOrder = req.query.sortOrder || "DESC";

    const whereClause = {};
    if (req.query.storeId) whereClause.store_id = req.query.storeId;
    if (req.query.vendorId) whereClause.vendor_id = req.query.vendorId;
    if (req.query.status) whereClause.status = req.query.status;
    if (search) whereClause[Op.or] = [{ notes: { [Op.iLike]: `%${search}%` } }];

    const { count, rows } = await PurchaseOrder.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { model: Store, as: "store", required: false },
        { model: Vendor, as: "vendor", required: false },
        { model: Currency, as: "currency", required: false },
        {
          model: PurchaseOrderItem,
          as: "items",
          required: false,
          include: [{ model: Product, as: "product", required: false }],
        },
      ],
      order: [[sortBy, sortOrder]],
      limit,
      offset,
    });

    res.json({
      data: rows.map((po) => {
        return {
          ...po.toJSON(),
          purchasingOrderDate: po.order_date,
          purchasingOrderReferenceNumber: po.po_number,
        };
      }),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

// Get by ID
router.get("/:id", validate([param("id").isUUID()]), async (req, res) => {
  try {
    const po = await PurchaseOrder.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        {
          model: PurchaseOrderItem,
          as: "items",
          include: [{ model: Product, as: "product" }],
        },
        { model: Store, as: "store" },
        { model: Vendor, as: "vendor" },
        { model: Currency, as: "currency" },
      ],
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    res.json(po);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

// Update header
router.put(
  "/:id",
  csrfProtection,
  validate([param("id").isUUID()]),
  async (req, res) => {
    try {
      const updated = await PurchaseOrderService.updatePurchaseOrder(
        req.params.id,
        req.body,
        req.user,
      );
      res.json(updated);
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      res
        .status(500)
        .json({ error: "Internal server error", details: error.message });
    }
  },
);

// PUT /api/purchase-orders/:id/send - Send purchase order (mark as sent)
router.put("/:id/send", csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const po = await PurchaseOrder.findOne({
      where: buildCompanyWhere(req, { id }),
    });
    if (!po)
      return res.status(404).json({ message: "Purchase order not found" });

    if (po.status !== "draft") {
      return res
        .status(400)
        .json({ message: "Only draft purchase orders can be sent" });
    }

    // Attempt to set sent metadata if columns exist; Sequelize will ignore unknown attributes
    await po.update({
      status: "sent",
      sent_by: req.user.id,
      sent_at: new Date(),
    });

    res.json({ message: "Purchase order sent successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Internal server error", details: error.message });
  }
});

// PUT /api/purchase-orders/:id/accept - Accept purchase order
router.put("/:id/accept", csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const po = await PurchaseOrder.findOne({
      where: buildCompanyWhere(req, { id }),
    });
    if (!po)
      return res.status(404).json({ message: "Purchase order not found" });

    if (po.status !== "sent") {
      return res
        .status(400)
        .json({ message: "Only sent purchase orders can be accepted" });
    }

    await po.update({
      status: "accepted",
      accepted_by: req.user.id,
      accepted_at: new Date(),
    });

    res.json({ message: "Purchase order accepted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Internal server error", details: error.message });
  }
});

// Receive
router.put("/:id/receive", csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const  po = await PurchaseOrder.findOne({
      where: buildCompanyWhere(req, { id }),
    });
    if (!po)
      return res.status(404).json({ message: "Purchase order not found" });

    // if (po.status !== "sent") {
    //   return res
    //     .status(400)
    //     .json({ message: "Only sent purchase orders can be accepted" });
    // }
    const result = await PurchaseOrderService.receive(id, po, req.user);
    res.json(result);
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

// Cancel
router.delete(
  "/:id",
  csrfProtection,
  validate([param("id").isUUID()]),
  async (req, res) => {
    try {
      const result = await PurchaseOrderService.cancel(req.params.id, req.user);
      res.json({ message: "Cancelled", data: result });
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      res
        .status(500)
        .json({ error: "Internal server error", details: error.message });
    }
  },
);

module.exports = router;
