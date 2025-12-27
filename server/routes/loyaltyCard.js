const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const LoyaltyCard = require('../models/LoyaltyCard');
const LoyaltyCardConfig = require('../models/LoyaltyCardConfig');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all loyalty cards
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', tier = '', status = '' } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};
    
    if (search) {
      whereClause[Op.or] = [
        { customer_name: { [Op.iLike]: `%${search}%` } },
        { customer_email: { [Op.iLike]: `%${search}%` } },
        { card_number: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (tier) {
      whereClause.tier_level = tier;
    }

    if (status) {
      whereClause.is_active = status === 'active';
    }

    const { count, rows } = await LoyaltyCard.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: rows,
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
      message: 'Error fetching loyalty cards',
      error: error.message
    });
  }
});

// Get loyalty card by ID
router.get('/:id', async (req, res) => {
  try {
    const loyaltyCard = await LoyaltyCard.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!loyaltyCard) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card not found'
      });
    }

    // Get recent transactions
    const transactions = await LoyaltyTransaction.findAll({
      where: { loyalty_card_id: req.params.id },
      order: [['transaction_date', 'DESC']],
      limit: 10
    });

    res.json({
      success: true,
      data: {
        ...loyaltyCard.toJSON(),
        recent_transactions: transactions
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching loyalty card',
      error: error.message
    });
  }
});

// Create new loyalty card
router.post('/', csrfProtection, async (req, res) => {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      card_number,
      notes
    } = req.body;

    // Use provided card_number or generate unique card number
    let cardNumber = card_number;
    if (!cardNumber || cardNumber.trim() === '') {
      cardNumber = 'LC' + Date.now().toString().slice(-8);
    } else {
      cardNumber = cardNumber.trim();
      
      // Check if card_number already exists in this company
      const existingCard = await LoyaltyCard.findOne({ 
        where: buildCompanyWhere(req, { card_number: cardNumber })
      });
      
      if (existingCard) {
        return res.status(400).json({
          success: false,
          message: `Loyalty card number "${cardNumber}" already exists in your company`,
          field: 'card_number',
          value: cardNumber
        });
      }
    }

    const loyaltyCard = await LoyaltyCard.create({
      companyId: req.user.companyId,
      card_number: cardNumber,
      customer_name,
      customer_email,
      customer_phone,
      notes,
      created_by: req.user.id
    });

    // Create welcome bonus transaction if configured
    const config = await LoyaltyCardConfig.findOne({ where: { is_active: true } });
    if (config && config.welcome_bonus_points > 0) {
      await LoyaltyTransaction.create({
        loyalty_card_id: loyaltyCard.id,
        transaction_type: 'bonus',
        points_amount: config.welcome_bonus_points,
        description: 'Welcome bonus points',
        points_balance_before: 0,
        points_balance_after: config.welcome_bonus_points,
        tier_before: 'bronze',
        tier_after: 'bronze',
        created_by: req.user.id
      });

      // Update loyalty card with bonus points
      await loyaltyCard.update({
        current_points: config.welcome_bonus_points,
        total_points_earned: config.welcome_bonus_points
      });
    }

    res.status(201).json({
      success: true,
      message: 'Loyalty card created successfully',
      data: loyaltyCard
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating loyalty card',
      error: error.message
    });
  }
});

// Update loyalty card
router.put('/:id', csrfProtection, async (req, res) => {
  try {
    const loyaltyCard = await LoyaltyCard.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!loyaltyCard) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card not found'
      });
    }

    // Check if card_number is being changed and validate uniqueness
    if (req.body.card_number && req.body.card_number.trim() !== '') {
      const newCardNumber = req.body.card_number.trim();
      
      if (newCardNumber !== loyaltyCard.card_number) {
        const existingCard = await LoyaltyCard.findOne({ 
          where: buildCompanyWhere(req, { 
            card_number: newCardNumber,
            id: { [Op.ne]: req.params.id }
          })
        });
        
        if (existingCard) {
          return res.status(400).json({
            success: false,
            message: `Loyalty card number "${newCardNumber}" already exists in your company`,
            field: 'card_number',
            value: newCardNumber
          });
        }
      }
    }

    const updatedCard = await loyaltyCard.update({
      ...req.body,
      updated_by: req.user.id
    });

    res.json({
      success: true,
      message: 'Loyalty card updated successfully',
      data: updatedCard
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating loyalty card',
      error: error.message
    });
  }
});

// Add points to loyalty card
router.post('/:id/add-points', csrfProtection, async (req, res) => {
  try {
    const { points, description, order_id } = req.body;
    
    const loyaltyCard = await LoyaltyCard.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!loyaltyCard) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card not found'
      });
    }

    const pointsBefore = loyaltyCard.current_points;
    const pointsAfter = pointsBefore + points;
    const tierBefore = loyaltyCard.tier_level;

    // Determine new tier based on total points
    // Note: LoyaltyCardConfig doesn't have tier thresholds, so we keep the current tier
    // If tier logic is needed, it should be added to LoyaltyCardConfig model
    let tierAfter = tierBefore;

    // Create transaction record
    await LoyaltyTransaction.create({
      loyalty_card_id: loyaltyCard.id,
      transaction_type: 'earn',
      points_amount: points,
      description: description || 'Points earned',
      order_id,
      points_balance_before: pointsBefore,
      points_balance_after: pointsAfter,
      tier_before: tierBefore,
      tier_after: tierAfter,
      created_by: req.user.id
    });

    // Update loyalty card
    await loyaltyCard.update({
      current_points: pointsAfter,
      total_points_earned: loyaltyCard.total_points_earned + points,
      tier_level: tierAfter,
      last_used_date: new Date()
    });

    res.json({
      success: true,
      message: 'Points added successfully',
      data: {
        points_added: points,
        new_balance: pointsAfter,
        tier_upgrade: tierAfter !== tierBefore ? tierAfter : null
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error adding points',
      error: error.message
    });
  }
});

// Redeem points from loyalty card
router.post('/:id/redeem-points', csrfProtection, async (req, res) => {
  try {
    const { points, description, order_id } = req.body;
    
    const loyaltyCard = await LoyaltyCard.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    if (!loyaltyCard) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card not found'
      });
    }

    if (loyaltyCard.current_points < points) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient points balance'
      });
    }

    const pointsBefore = loyaltyCard.current_points;
    const pointsAfter = pointsBefore - points;

    // Create transaction record
    await LoyaltyTransaction.create({
      loyalty_card_id: loyaltyCard.id,
      transaction_type: 'redeem',
      points_amount: -points,
      description: description || 'Points redeemed',
      order_id,
      points_balance_before: pointsBefore,
      points_balance_after: pointsAfter,
      tier_before: loyaltyCard.tier_level,
      tier_after: loyaltyCard.tier_level,
      created_by: req.user.id
    });

    // Update loyalty card
    await loyaltyCard.update({
      current_points: pointsAfter,
      total_points_redeemed: loyaltyCard.total_points_redeemed + points,
      last_used_date: new Date()
    });

    res.json({
      success: true,
      message: 'Points redeemed successfully',
      data: {
        points_redeemed: points,
        new_balance: pointsAfter
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error redeeming points',
      error: error.message
    });
  }
});

// Get loyalty card transactions
router.get('/:id/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows } = await LoyaltyTransaction.findAndCountAll({
      where: { loyalty_card_id: req.params.id },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['transaction_date', 'DESC']]
    });

    res.json({
      success: true,
      data: rows,
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
      message: 'Error fetching transactions',
      error: error.message
    });
  }
});

// Delete loyalty card
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const loyaltyCard = await LoyaltyCard.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });
    
    if (!loyaltyCard) {
      return res.status(404).json({
        success: false,
        message: 'Loyalty card not found'
      });
    }

    await loyaltyCard.destroy();

    res.json({
      success: true,
      message: 'Loyalty card deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting loyalty card',
      error: error.message
    });
  }
});

module.exports = router;
