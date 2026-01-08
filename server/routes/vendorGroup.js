const express = require("express");
const { body, validationResult } = require("express-validator");
const router = express.Router();
const { VendorGroup, Vendor, Account, Company, User } = require("../models");
const auth = require("../middleware/auth");
const stripCompanyId = require("../middleware/stripCompanyId");
const { csrfProtection } = require("../middleware/csrfProtection");
const {
  companyFilter,
  buildCompanyWhere,
} = require("../middleware/companyFilter");
const autoCodeService = require("../utils/autoCodeService");
const { sequelize } = require("../models");
const { Op } = require("sequelize");

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // Prevent companyId override attacks

router.get("/stats", async (req, res) => {
  try {
    const totalGroups = await VendorGroup.count({
      where: buildCompanyWhere(req),
    });
    const activeGroups = await VendorGroup.count({
      where: buildCompanyWhere(req, { is_active: true }),
    });
    const inactiveGroups = await VendorGroup.count({
      where: buildCompanyWhere(req, { is_active: false }),
    });
    // const defaultGroups = await VendorGroup.count({
    //   where: buildCompanyWhere(req, { is_default: true })
    // });

    res.json({
      totalGroups,
      activeGroups,
      inactiveGroups,
      //   defaultGroups,
      lastUpdate: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching vendor groups stats:", error);
    res.status(500).json({ error: "Failed to fetch vendor groups statistics" });
  }
});

// List vendor groups with pagination and search
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      sortBy = "created_at",
      sortOrder = "DESC",
    } = req.query;

    const offset = (page - 1) * limit;
    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { vendor_group_name: { [Op.iLike]: `%${search}%` } },
        { vendor_group_code: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await VendorGroup.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        {
          model: Account,
          as: "liabilityAccount",
          attributes: ["id", "code", "name"],
          required: false,
        },
        {
          model: Account,
          as: "payableAccount",
          attributes: ["id", "code", "name"],
          required: false,
        },
        {
          model: User,
          as: "creator",
          attributes: ["id", "first_name", "last_name", "email"],
        },
        {
          model: User,
          as: "updater",
          attributes: ["id", "first_name", "last_name", "email"],
        },
      ],
      order: [[sortBy, sortOrder.toUpperCase()]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    const transformed = rows.map((r) => ({
      ...r.toJSON(),
      default_liability_account_id: r.liablity_account_id,
      account_payable_id: r.payableAccount ? r.payableAccount.id : null,
      default_liability_account_name: r.liabilityAccount
        ? `${r.liabilityAccount.code} - ${r.liabilityAccount.name}`
        : null,
      account_payable_name: r.payableAccount
        ? `${r.payableAccount.code} - ${r.payableAccount.name}`
        : null,
    }));

    res.json({
      success: true,
      data: transformed,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.log('error fetching vendor group', error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch vendor groups" });
  }
});

// Get all vendor groups for dropdowns
router.get("/active", async (req, res) => {
  try {
    const groups = await VendorGroup.findAll({
      where: buildCompanyWhere(req, {}),
      attributes: ["id", "vendor_group_name", "vendor_group_code"],
      order: [["vendor_group_name", "ASC"]],
    });
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch vendor groups" });
  }
});

// Get vendor group by ID
router.get("/:id", async (req, res) => {
  try {
    const group = await VendorGroup.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        {
          model: Account,
          as: "liabilityAccount",
          attributes: ["id", "code", "name"],
          required: false,
        },
        {
          model: Account,
          as: "payableAccount",
          attributes: ["id", "code", "name"],
          required: false,
        },
        {
          model: User,
          as: "creator",
          attributes: ["id", "first_name", "last_name", "email"],
          required: false,
        },
        {
          model: User,
          as: "updater",
          attributes: ["id", "first_name", "last_name", "email"],
          required: false,
        },
      ],
    });

    if (!group)
      return res.status(404).json({ error: "Vendor group not found" });

    res.json(group);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch vendor group" });
  }
});

// Create vendor group
router.post(
  "/",
  [
    body("vendor_group_name")
      .trim()
      .notEmpty()
      .withMessage("Vendor group name is required")
      .isLength({ max: 100 })
      .withMessage("Vendor group name must not exceed 100 characters"),
    body("description")
      .optional()
      .isLength({ max: 500 })
      .withMessage("Description must not exceed 500 characters"),
    body("default_liability_account_id")
      .optional()
      .isUUID()
      .withMessage("Liability account ID must be a valid UUID"),
    body("account_payable_id")
      .optional()
      .isUUID()
      .withMessage("Payable account ID must be a valid UUID"),
  ],
  csrfProtection,
  async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
      console.log("Creating new vendor group...", req.body);
      if (!req.user || !req.user.companyId) {
        await transaction.rollback();
        return res.status(403).json({ error: "Company access required" });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        await transaction.rollback();
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        vendor_group_name,
        description,
        default_liability_account_id,
        account_payable_id,
      } = req.body;
      const trimmedName = vendor_group_name?.trim();
      if (!trimmedName) {
        await transaction.rollback();
        return res
          .status(400)
          .json({ error: "Vendor group name cannot be empty" });
      }

      // Check uniqueness within company
      const existing = await VendorGroup.findOne({
        where: {
          vendor_group_name: trimmedName,
          companyId: req.user.companyId,
        },
        transaction,
      });
      if (existing) {
        await transaction.rollback();
        return res
          .status(400)
          .json({
            error:
              "A vendor group with this name already exists in your company",
          });
      }

      // Fetch company for code generation
      const company = await Company.findByPk(req.user.companyId, {
        transaction,
      });
      if (!company) {
        await transaction.rollback();
        return res.status(404).json({ error: "Company not found" });
      }

      const companyCode = company?.code || null;
      const vendor_group_code = await autoCodeService.generateNextCode(
        "vendor_groups",
        req.user.companyId,
        {
          transaction,
          fallbackPrefix: "VG",
          fallbackFormat: "{PREFIX}-{NUMBER}",
          companyCode,
        }
      );

      // Validate accounts belong to company
      if (default_liability_account_id) {
        const acc = await Account.findOne({
          where: buildCompanyWhere(req, { id: default_liability_account_id }),
          transaction,
        });
        if (!acc) {
          await transaction.rollback();
          return res
            .status(400)
            .json({
              error:
                "Liability account not found or does not belong to your company",
            });
        }
      }

      if (account_payable_id) {
        const acc = await Account.findOne({
          where: buildCompanyWhere(req, { id: account_payable_id }),
          transaction,
        });
        if (!acc) {
          await transaction.rollback();
          return res
            .status(400)
            .json({
              error:
                "Payable account not found or does not belong to your company",
            });
        }
      }

      const created = await VendorGroup.create(
        {
          vendor_group_name: trimmedName,
          vendor_group_code,
          companyId: req.user.companyId,
          liablity_account_id: default_liability_account_id || null,
          payable_account_id: account_payable_id || null,
          description: description?.trim() || null,
          created_by: req.user.id,
        },
        { transaction }
      );

      await transaction.commit();

      const createdWithAssoc = await VendorGroup.findByPk(created.id, {
        include: [
          {
            model: Account,
            as: "liabilityAccount",
            attributes: ["id", "code", "name"],
            required: false,
          },
          {
            model: Account,
            as: "payableAccount",
            attributes: ["id", "code", "name"],
            required: false,
          },
          {
            model: User,
            as: "creator",
            attributes: ["id", "first_name", "last_name", "email"],
            required: false,
          },
        ],
      });

      res.status(201).json(createdWithAssoc);
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res
          .status(400)
          .json({
            error: "Duplicate entry",
            message: error.message,
            fields: error.fields,
          });
      }
      res
        .status(500)
        .json({
          error: "Failed to create vendor group",
          message: error.message,
        });
      await transaction.rollback();
    }
  }
);

// Update vendor group
router.put(
  "/:id",
  [
    body("vendor_group_name")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Vendor group name cannot be empty")
      .isLength({ max: 100 })
      .withMessage("Vendor group name must not exceed 100 characters"),
    body("description")
      .optional()
      .isLength({ max: 500 })
      .withMessage("Description must not exceed 500 characters"),
    body("default_liability_account_id")
      .optional()
      .isUUID()
      .withMessage("Liability account ID must be a valid UUID"),
    body("account_payable_id")
      .optional()
      .isUUID()
      .withMessage("Payable account ID must be a valid UUID"),
  ],
  csrfProtection,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty())
        return res.status(400).json({ errors: errors.array() });

      const group = await VendorGroup.findOne({
        where: buildCompanyWhere(req, { id: req.params.id }),
      });
      if (!group)
        return res.status(404).json({ error: "Vendor group not found" });

      // Prevent code updates
      if (
        req.body.vendor_group_code &&
        req.body.vendor_group_code !== group.vendor_group_code
      ) {
        return res
          .status(400)
          .json({ error: "Vendor group code cannot be changed." });
      }

      const newName = req.body.vendor_group_name?.trim();
      if (newName && newName !== group.vendor_group_name) {
        const existing = await VendorGroup.findOne({
          where: buildCompanyWhere(req, {
            vendor_group_name: newName,
            id: { [Op.ne]: req.params.id },
          }),
        });
        if (existing) {
          return res
            .status(400)
            .json({
              error: `Vendor group name "${newName}" already exists in your company`,
            });
        }
      }

      // Validate accounts
      if (req.body.default_liability_account_id) {
        const acc = await Account.findOne({
          where: buildCompanyWhere(req, {
            id: req.body.default_liability_account_id,
          }),
        });
        if (!acc)
          return res
            .status(400)
            .json({
              error:
                "Liability account not found or does not belong to your company",
            });
      }
      if (req.body.account_payable_id) {
        const acc = await Account.findOne({
          where: buildCompanyWhere(req, { id: req.body.account_payable_id }),
        });
        if (!acc)
          return res
            .status(400)
            .json({
              error:
                "Payable account not found or does not belong to your company",
            });
      }

      await group.update({
        vendor_group_name: newName || group.vendor_group_name,
        description:
          req.body.description !== undefined
            ? req.body.description
            : group.description,
        liability_account_id:
          req.body.default_liability_account_id !== undefined
            ? req.body.default_liability_account_id
            : group.liability_account_id,
        payable_account_id:
          req.body.account_payable_id !== undefined
            ? req.body.account_payable_id
            : group.payable_account_id,
        updated_by: req.user.id,
      });

      const updated = await VendorGroup.findByPk(req.params.id, {
        include: [
          {
            model: Account,
            as: "liabilityAccount",
            attributes: ["id", "code", "name"],
            required: false,
          },
          {
            model: Account,
            as: "payableAccount",
            attributes: ["id", "code", "name"],
            required: false,
          },
          {
            model: User,
            as: "creator",
            attributes: ["id", "first_name", "last_name", "email"],
            required: false,
          },
          {
            model: User,
            as: "updater",
            attributes: ["id", "first_name", "last_name", "email"],
            required: false,
          },
        ],
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update vendor group" });
    }
  }
);

// Check usage before deletion
router.get("/:id/usage", async (req, res) => {
  try {
    const group = await VendorGroup.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
    });
    if (!group)
      return res.status(404).json({ error: "Vendor group not found" });

    const usageCount = await Vendor.count({
      where: { vendor_group_id: req.params.id, companyId: req.user.companyId },
    });

    res.json({
      isUsed: usageCount > 0,
      usageCount,
      canDelete: usageCount === 0,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to check vendor group usage" });
  }
});

// Delete vendor group
router.delete("/:id", csrfProtection, async (req, res) => {
  try {
    const group = await VendorGroup.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
    });
    if (!group)
      return res.status(404).json({ error: "Vendor group not found" });

    const usageCount = await Vendor.count({
      where: { vendor_group_id: req.params.id, companyId: req.user.companyId },
    });
    if (usageCount > 0)
      return res
        .status(400)
        .json({
          error: "Cannot delete vendor group that has associated vendors",
        });

    await group.destroy();
    res.json({ message: "Vendor group deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete vendor group" });
  }
});

module.exports = router;
