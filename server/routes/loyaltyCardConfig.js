const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { LoyaltyCardConfig, User, Company } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const autoCodeService = require('../utils/autoCodeService');
const { sequelize } = require('../models');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get loyalty card configuration statistics
router.get('/stats', async (req, res) => {
  try {
    const totalConfigs = await LoyaltyCardConfig.count({
      where: buildCompanyWhere(req)
    });
    const activeConfigs = await LoyaltyCardConfig.count({ 
      where: buildCompanyWhere(req, { is_active: true })
    });
    const inactiveConfigs = await LoyaltyCardConfig.count({ 
      where: buildCompanyWhere(req, { is_active: false })
    });
    const defaultConfigs = await LoyaltyCardConfig.count({ 
      where: buildCompanyWhere(req, { is_default: true })
    });

    res.json({
      success: true,
      data: {
        totalConfigs,
        activeConfigs,
        inactiveConfigs,
        defaultConfigs
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});

// Get all loyalty card configurations
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status = '' } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};
    
    if (search) {
      whereClause[Op.or] = [
        { loyalty_card_name: { [Op.iLike]: `%${search}%` } },
        { loyalty_card_code: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (status) {
      whereClause.is_active = status === 'active';
    }

    const { count, rows } = await LoyaltyCardConfig.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { 
          model: User, 
          as: 'createdByUser', 
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        },
        { 
          model: User, 
          as: 'updatedByUser', 
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
    });

    // Transform data to include user names
    const transformedConfigs = rows.map(config => ({
      ...config.toJSON(),
      created_by_name: config.createdByUser ? `${config.createdByUser.first_name} ${config.createdByUser.last_name}` : null,
      updated_by_name: config.updatedByUser ? `${config.updatedByUser.first_name} ${config.updatedByUser.last_name}` : null
    }));

    res.json({
      success: true,
      data: transformedConfigs,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching loyalty card configurations',
      error: error.message
    });
  }
});

// Get loyalty card configuration by ID
router.get('/:id', async (req, res) => {
  try {
    const config = await LoyaltyCardConfig.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { 
          model: User, 
          as: 'createdByUser', 
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        },
        { 
          model: User, 
          as: 'updatedByUser', 
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        }
      ]
    });
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card configuration not found'
      });
    }

    // Transform data to include user names
    const transformedConfig = {
      ...config.toJSON(),
      created_by_name: config.createdByUser ? `${config.createdByUser.first_name} ${config.createdByUser.last_name}` : null,
      updated_by_name: config.updatedByUser ? `${config.updatedByUser.first_name} ${config.updatedByUser.last_name}` : null
    };

    res.json({
      success: true,
      data: transformedConfig
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching loyalty card configuration',
      error: error.message
    });
  }
});

// Create new loyalty card configuration
router.post('/', csrfProtection, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    // Validate companyId exists
    if (!req.user || !req.user.companyId) {
      await transaction.rollback();
      return res.status(403).json({ 
        success: false,
        error: 'Company access required. Please ensure you are assigned to a company.' 
      });
    }

    const {
      loyalty_card_name,
      card_color,
      entrance_points,
      allow_gaining_cash_sales,
      allow_gaining_credit_sales,
      is_default,
      redemption_rate,
      minimum_redemption_points,
      maximum_redemption_points,
      birthday_bonus_points,
      welcome_bonus_points,
      // Gain Rates Configuration
      gain_rate_lower_limit,
      gain_rate_upper_limit,
      gain_rate_type,
      gain_rate_value,
      // Discount Rates Configuration
      discount_rate_lower_limit,
      discount_rate_upper_limit,
      discount_rate_type,
      discount_rate_value
    } = req.body;

    // Validate required fields
    if (!loyalty_card_name || !loyalty_card_name.trim()) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Loyalty card name is required'
      });
    }

    // Trim loyalty card name
    const trimmedCardName = loyalty_card_name.trim();

    // Check if loyalty_card_name already exists in this company
    const existingConfigByName = await LoyaltyCardConfig.findOne({
      where: buildCompanyWhere(req, { loyalty_card_name: trimmedCardName }),
      transaction
    });
    
    if (existingConfigByName) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Loyalty card configuration name "${trimmedCardName}" already exists in your company`,
        field: 'loyalty_card_name',
        value: trimmedCardName
      });
    }

    // Get company code for code generation
    const company = await Company.findByPk(req.user.companyId, { transaction });
    if (!company) {
      await transaction.rollback();
      return res.status(404).json({ 
        success: false,
        error: 'Company not found' 
      });
    }
    const companyCode = company?.code || null;

    // Auto-generate loyalty card code
    const loyalty_card_code = await autoCodeService.generateNextCode(
      'loyalty_card_configs',
      req.user.companyId,
      {
        transaction,
        fallbackPrefix: 'LOY',
        fallbackFormat: '{PREFIX}-{NUMBER}',
        companyCode
      }
    );

    // If this is being set as default, unset all other defaults for the same company
    if (is_default) {
      await LoyaltyCardConfig.update(
        { is_default: false },
        { 
          where: buildCompanyWhere(req, { is_default: true }),
          transaction
        }
      );
    }

    const config = await LoyaltyCardConfig.create({
      companyId: req.user.companyId,
      loyalty_card_name: trimmedCardName,
      loyalty_card_code,
      card_color,
      entrance_points,
      allow_gaining_cash_sales,
      allow_gaining_credit_sales,
      is_default: is_default || false,
      redemption_rate,
      minimum_redemption_points,
      maximum_redemption_points,
      birthday_bonus_points,
      welcome_bonus_points,
      // Gain Rates Configuration
      gain_rate_lower_limit,
      gain_rate_upper_limit,
      gain_rate_type,
      gain_rate_value,
      // Discount Rates Configuration
      discount_rate_lower_limit,
      discount_rate_upper_limit,
      discount_rate_type,
      discount_rate_value,
      created_by: req.user.id
    }, { transaction });

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: 'Loyalty card configuration created successfully',
      data: config
    });
  } catch (error) {
    await transaction.rollback();
    
    // Handle unique constraint violations
    if (error.name === 'SequelizeUniqueConstraintError') {
      const constraint = error.fields || {};
      const constraintName = error.parent?.constraint || '';
      
      if (constraint.loyalty_card_name || constraintName.includes('loyalty_card_name')) {
        return res.status(400).json({
          success: false,
          message: `A loyalty card configuration with the name "${req.body.loyalty_card_name}" already exists for your company.`
        });
      }
      
      if (constraint.loyalty_card_code || constraintName.includes('loyalty_card_code')) {
        return res.status(400).json({
          success: false,
          message: 'A loyalty card configuration with this code already exists. This should not happen as codes are auto-generated. Please try again.'
        });
      }
      
      return res.status(400).json({
        success: false,
        message: error.message || 'A record with this information already exists'
      });
    }

    // Handle validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors?.map(err => ({
        field: err.path,
        message: err.message
      })) || [];
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating loyalty card configuration',
      error: error.message || 'Unknown error occurred'
    });
  }
});

// Update loyalty card configuration
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const config = await LoyaltyCardConfig.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card configuration not found'
      });
    }

    const {
      loyalty_card_name,
      card_color,
      entrance_points,
      allow_gaining_cash_sales,
      allow_gaining_credit_sales,
      is_default,
      redemption_rate,
      minimum_redemption_points,
      maximum_redemption_points,
      birthday_bonus_points,
      welcome_bonus_points,
      // Gain Rates Configuration
      gain_rate_lower_limit,
      gain_rate_upper_limit,
      gain_rate_type,
      gain_rate_value,
      // Discount Rates Configuration
      discount_rate_lower_limit,
      discount_rate_upper_limit,
      discount_rate_type,
      discount_rate_value,
      is_active
    } = req.body;

    // Prevent code updates - code is auto-generated and immutable
    if (req.body.loyalty_card_code && req.body.loyalty_card_code !== config.loyalty_card_code) {
      return res.status(400).json({
        success: false,
        message: 'Loyalty card code cannot be changed. It is automatically generated.'
      });
    }

    // Trim loyalty card name if provided
    const trimmedCardName = loyalty_card_name?.trim() || config.loyalty_card_name;

    // Check if loyalty_card_name is being changed and validate uniqueness
    if (trimmedCardName && trimmedCardName !== config.loyalty_card_name) {
      const existingConfig = await LoyaltyCardConfig.findOne({
        where: buildCompanyWhere(req, { 
          loyalty_card_name: trimmedCardName,
          id: { [Op.ne]: req.params.id }
        })
      });
      
      if (existingConfig) {
        return res.status(400).json({
          success: false,
          message: `Loyalty card configuration name "${trimmedCardName}" already exists in your company`,
          field: 'loyalty_card_name',
          value: trimmedCardName
        });
      }
    }

    // If this is being set as default, unset all other defaults
    if (is_default && !config.is_default) {
      await LoyaltyCardConfig.update(
        { is_default: false },
        { where: buildCompanyWhere(req, { is_default: true }) }
      );
    }

    const updateData = {
      loyalty_card_name: trimmedCardName,
      card_color,
      entrance_points,
      allow_gaining_cash_sales,
      allow_gaining_credit_sales,
      is_default,
      redemption_rate,
      minimum_redemption_points,
      maximum_redemption_points,
      birthday_bonus_points,
      welcome_bonus_points,
      // Gain Rates Configuration
      gain_rate_lower_limit,
      gain_rate_upper_limit,
      gain_rate_type,
      gain_rate_value,
      // Discount Rates Configuration
      discount_rate_lower_limit,
      discount_rate_upper_limit,
      discount_rate_type,
      discount_rate_value,
      is_active,
      updated_by: req.user.id
    };

    const updatedConfig = await config.update(updateData);

    res.json({
      success: true,
      message: 'Loyalty card configuration updated successfully',
      data: updatedConfig
    });
  } catch (error) {
    
    // Handle unique constraint violations
    if (error.name === 'SequelizeUniqueConstraintError') {
      const field = error.errors[0].path;
      return res.status(400).json({
        success: false,
        message: `${field === 'loyalty_card_name' ? 'Card name' : 'Card code'} already exists`
      });
    }

    // Handle validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors.map(err => ({
        field: err.path,
        message: err.message
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating loyalty card configuration',
      error: error.message
    });
  }
});

// Set configuration as default
router.post('/:id/set-default', csrfProtection, async (req, res) => {
  try {
    const config = await LoyaltyCardConfig.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card configuration not found'
      });
    }

    if (!config.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Cannot set inactive configuration as default'
      });
    }

    // Unset all other defaults for the same company
    await LoyaltyCardConfig.update(
      { is_default: false },
      { where: buildCompanyWhere(req, { is_default: true }) }
    );

    // Set this configuration as default
    const updatedConfig = await config.update({
      is_default: true,
      updated_by: req.user.id
    });

    res.json({
      success: true,
      message: 'Default loyalty card configuration updated successfully',
      data: updatedConfig
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error setting default configuration',
      error: error.message
    });
  }
});

// Delete loyalty card configuration
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const config = await LoyaltyCardConfig.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card configuration not found'
      });
    }

    // Check if this is the default configuration
    if (config.is_default) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete default configuration. Please set another configuration as default first.'
      });
    }

    // TODO: Check if any loyalty cards are using this configuration
    // For now, we'll allow deletion but this should be implemented
    // const cardsUsingConfig = await LoyaltyCard.count({ where: { loyalty_config_id: config.id } });
    // if (cardsUsingConfig > 0) {
    //   return res.status(400).json({
    //     success: false,
    //     message: `Cannot delete configuration. ${cardsUsingConfig} loyalty cards are using this configuration.`
    //   });
    // }

    await config.destroy();

    res.json({
      success: true,
      message: 'Loyalty card configuration deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting loyalty card configuration',
      error: error.message
    });
  }
});

module.exports = router;
