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
    const ordered = await PurchaseOrder.count({
      where: buildCompanyWhere(req, { status: "ordered" }),
    });
    const partiallyReceived = await PurchaseOrder.count({
      where: buildCompanyWhere(req, { status: "partially_received" }),
    });
    const received = await PurchaseOrder.count({
      where: buildCompanyWhere(req, { status: "received" }),
    });
    const cancelled = await PurchaseOrder.count({
      where: buildCompanyWhere(req, { status: "cancelled" }),
    });

    // Sum total_amount for all purchase orders in company
    const totalAmountSum =
      (await PurchaseOrder.sum("total_amount", {
        where: buildCompanyWhere(req),
      })) || 0;

    res.json({
      stats: {
        total,
        draft,
        ordered,
        partiallyReceived,
        received,
        cancelled,
        totalAmount: totalAmountSum,
      },
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
    body("orderDate").notEmpty().withMessage("orderDate is required"),
    body("vendorId").notEmpty().withMessage("vendorId is required"),
    body("storeId").notEmpty().withMessage("storeId is required"),
    body("items").isArray({ min: 1 }).withMessage("items array required"),
    body("items.*.productId")
      .notEmpty()
      .withMessage("productId is required for item"),
    body("items.*.quantityOrdered")
      .notEmpty()
      .withMessage("quantityOrdered is required for item"),
    body("items.*.unitPrice")
      .notEmpty()
      .withMessage("unitPrice is required for item"),
  ]),
  async (req, res) => {
    // Create purchase order (delegate heavy lifting to service)
    try {
      if (!req.user.companyId)
        return res.status(400).json({ error: "Company ID is required" });
      const payload = { ...req.body, companyId: req.user.companyId };
      const created = await PurchaseOrderService.createPurchaseOrder(
        payload,
        req.user
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
  }
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
      data: rows,
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
        req.user
      );
      res.json(updated);
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      res
        .status(500)
        .json({ error: "Internal server error", details: error.message });
    }
  }
);

// Receive
router.post(
  "/:id/receive",
  csrfProtection,
  validate([
    param("id").isUUID(),
    body("items").isArray().withMessage("items required"),
  ]),
  async (req, res) => {
    try {
      const result = await PurchaseOrderService.receive(
        req.params.id,
        req.body,
        req.user
      );
      res.json(result);
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      res
        .status(500)
        .json({ error: "Internal server error", details: error.message });
    }
  }
);

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
  }
);

module.exports = router;
