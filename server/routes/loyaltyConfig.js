const express = require('express');
const router = express.Router();
const LoyaltyConfig = require('../models/LoyaltyConfig');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get loyalty configuration
router.get('/', async (req, res) => {
  try {
    const config = await LoyaltyConfig.findOne({ 
      where: buildCompanyWhere(req, { is_active: true }),
      order: [['created_at', 'DESC']]
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'No active loyalty configuration found'
      });
    }

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching loyalty configuration',
      error: error.message
    });
  }
});

// Get all loyalty configurations
router.get('/all', async (req, res) => {
  try {
    const configs = await LoyaltyConfig.findAll({
      where: buildCompanyWhere(req),
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching loyalty configurations',
      error: error.message
    });
  }
});

// Create new loyalty configuration
router.post('/', csrfProtection, async (req, res) => {
  try {
    const {
      config_name,
      points_per_dollar,
      redemption_rate,
      minimum_redemption_points,
      maximum_redemption_percentage,
      points_expiry_days,
      tier_bronze_threshold,
      tier_silver_threshold,
      tier_gold_threshold,
      tier_platinum_threshold,
      birthday_bonus_points,
      welcome_bonus_points
    } = req.body;

    // Validate config_name if provided
    if (config_name && config_name.trim() !== '') {
      const trimmedConfigName = config_name.trim();
      
      // Check if config_name already exists in this company
      const existingConfig = await LoyaltyConfig.findOne({
        where: buildCompanyWhere(req, { config_name: trimmedConfigName })
      });
      
      if (existingConfig) {
        return res.status(400).json({
          success: false,
          message: `Loyalty configuration name "${trimmedConfigName}" already exists in your company`,
          field: 'config_name',
          value: trimmedConfigName
        });
      }
    }

    // Deactivate current active configuration
    await LoyaltyConfig.update(
      { is_active: false },
      { where: buildCompanyWhere(req, { is_active: true }) }
    );

    const config = await LoyaltyConfig.create({
      companyId: req.user.companyId,
      config_name: config_name?.trim() || config_name,
      points_per_dollar,
      redemption_rate,
      minimum_redemption_points,
      maximum_redemption_percentage,
      points_expiry_days,
      tier_bronze_threshold,
      tier_silver_threshold,
      tier_gold_threshold,
      tier_platinum_threshold,
      birthday_bonus_points,
      welcome_bonus_points,
      is_active: true,
      created_by: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Loyalty configuration created successfully',
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating loyalty configuration',
      error: error.message
    });
  }
});

// Update loyalty configuration
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const config = await LoyaltyConfig.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty configuration not found'
      });
    }

    // Check if config_name is being changed and validate uniqueness
    if (req.body.config_name && req.body.config_name.trim() !== '') {
      const newConfigName = req.body.config_name.trim();
      
      if (newConfigName !== config.config_name) {
        const existingConfig = await LoyaltyConfig.findOne({
          where: buildCompanyWhere(req, { 
            config_name: newConfigName,
            id: { [Op.ne]: req.params.id }
          })
        });
        
        if (existingConfig) {
          return res.status(400).json({
            success: false,
            message: `Loyalty configuration name "${newConfigName}" already exists in your company`,
            field: 'config_name',
            value: newConfigName
          });
        }
      }
    }

    const updatedConfig = await config.update({
      ...req.body,
      updated_by: req.user.id
    });

    res.json({
      success: true,
      message: 'Loyalty configuration updated successfully',
      data: updatedConfig
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating loyalty configuration',
      error: error.message
    });
  }
});

// Activate loyalty configuration
router.post('/:id/activate', csrfProtection, async (req, res) => {
  try {
    const config = await LoyaltyConfig.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty configuration not found'
      });
    }

    // Deactivate current active configuration
    await LoyaltyConfig.update(
      { is_active: false },
      { where: buildCompanyWhere(req, { is_active: true }) }
    );

    // Activate selected configuration
    await config.update({ 
      is_active: true,
      updated_by: req.user.id
    });

    res.json({
      success: true,
      message: 'Loyalty configuration activated successfully',
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error activating loyalty configuration',
      error: error.message
    });
  }
});

// Delete loyalty configuration
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const config = await LoyaltyConfig.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty configuration not found'
      });
    }

    if (config.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete active configuration. Please activate another configuration first.'
      });
    }

    await config.destroy();

    res.json({
      success: true,
      message: 'Loyalty configuration deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting loyalty configuration',
      error: error.message
    });
  }
});

module.exports = router;
