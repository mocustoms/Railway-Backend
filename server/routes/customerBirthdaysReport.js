const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { 
  Customer, 
  CustomerGroup, 
  LoyaltyCardConfig,
  User 
} = require('../models');
const { Op } = require('sequelize');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// GET /api/customer-birthdays-report - Fetch customer birthdays data
router.get('/', csrfProtection, async (req, res) => {
  try {
    const { 
      customerGroupId, 
      loyaltyCardId, 
      daysBefore, 
      search, 
      sortBy = 'daysLeft', 
      sortOrder = 'asc',
      page = 1,
      limit = 10
    } = req.query;

    // Build where clause
    const whereClause = {};

    // Customer Group filter
    if (customerGroupId) {
      whereClause.customer_group_id = customerGroupId;
    }

    // Loyalty Card filter
    if (loyaltyCardId) {
      whereClause.loyalty_card_config_id = loyaltyCardId;
    }

    // Always filter for customers with birthdays
    whereClause.birthday = {
      [Op.not]: null
    };

    // Search functionality
    if (search) {
      whereClause[Op.or] = [
        { customer_id: { [Op.iLike]: `%${search}%` } },
        { full_name: { [Op.iLike]: `%${search}%` } },
        { phone_number: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Map frontend sort fields to database fields
    const sortFieldMap = {
      'customerId': 'customer_id',
      'fullName': 'full_name',
      'phone': 'phone_number',
      'address': 'address',
      'birthday': 'birthday'
    };

    const mappedSortBy = sortFieldMap[sortBy] || 'birthday';

    // Build final where clause with company filter
    const finalWhereClause = buildCompanyWhere(req, whereClause);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalWhereClause.companyId = req.user.companyId;
    }

    // Fetch customers with all required associations
    const customers = await Customer.findAll({
      where: finalWhereClause,
      include: [
        { 
          model: CustomerGroup, 
          as: 'group',
          attributes: ['id', 'group_name', 'group_code'] 
        },
        { 
          model: LoyaltyCardConfig,
          as: 'loyaltyCardConfig', 
          attributes: ['id', 'loyalty_card_name'] 
        }
      ],
      order: [[mappedSortBy, sortOrder.toUpperCase()]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });


    // Calculate days left for each customer and filter by daysBefore
    const today = new Date();
    const currentYear = today.getFullYear();
    
    const processedCustomers = customers
      .map(customer => {
        if (!customer.birthday) {
          return null;
        }

        const birthDate = new Date(customer.birthday);
        const birthdayThisYear = new Date(currentYear, birthDate.getMonth(), birthDate.getDate());
        
        // If birthday has passed this year, use next year
        if (birthdayThisYear < today) {
          birthdayThisYear.setFullYear(currentYear + 1);
        }

        const daysLeft = Math.ceil((birthdayThisYear - today) / (1000 * 60 * 60 * 24));
        
        return {
          id: customer.id,
          customerId: customer.customer_id,
          fullName: customer.full_name,
          phone: customer.phone_number || '--',
          address: customer.address || '--',
          daysLeft: daysLeft,
          birthday: birthDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          customerGroup: customer.group?.group_name || '--',
          loyaltyCard: customer.loyaltyCardConfig?.loyalty_card_name || '--',
          isActive: customer.is_active
        };
      })
      .filter(customer => customer !== null);

    // Apply daysBefore filter after processing
    let filteredCustomers = processedCustomers;
    if (daysBefore) {
      const days = parseInt(daysBefore);
      filteredCustomers = processedCustomers.filter(customer => customer.daysLeft <= days);
    }

    // Handle sorting for calculated fields
    if (sortBy === 'daysLeft') {
      filteredCustomers.sort((a, b) => {
        if (sortOrder.toLowerCase() === 'asc') {
          return a.daysLeft - b.daysLeft;
        } else {
          return b.daysLeft - a.daysLeft;
        }
      });
    }

    // Get total count for pagination (using finalWhereClause from above)
    const totalCustomers = await Customer.count({
      where: finalWhereClause,
      include: [
        { 
          model: CustomerGroup, 
          as: 'group'
        },
        { 
          model: LoyaltyCardConfig,
          as: 'loyaltyCardConfig'
        }
      ]
    });

    // Calculate total count after daysBefore filtering
    let totalFilteredCount = filteredCustomers.length;
    if (daysBefore) {
      // For accurate pagination, we need to count all customers that match the daysBefore criteria
      const allCustomers = await Customer.findAll({
        where: finalWhereClause,
        include: [
          { 
            model: CustomerGroup, 
            as: 'group'
          },
          { 
            model: LoyaltyCardConfig,
            as: 'loyaltyCardConfig'
          }
        ]
      });

      const allProcessedCustomers = allCustomers
        .map(customer => {
          if (!customer.birthday) return null;
          
          const birthDate = new Date(customer.birthday);
          const birthdayThisYear = new Date(currentYear, birthDate.getMonth(), birthDate.getDate());
          
          if (birthdayThisYear < today) {
            birthdayThisYear.setFullYear(currentYear + 1);
          }

          const daysLeft = Math.ceil((birthdayThisYear - today) / (1000 * 60 * 60 * 24));
          return daysLeft <= parseInt(daysBefore) ? 1 : 0;
        })
        .filter(val => val !== null);

      totalFilteredCount = allProcessedCustomers.reduce((sum, val) => sum + val, 0);
    }

    res.json({
      success: true,
      data: filteredCustomers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalFilteredCount,
        pages: Math.ceil(totalFilteredCount / parseInt(limit))
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching customer birthdays data',
      error: error.message
    });
  }
});

// GET /api/customer-birthdays-report/stats - Fetch customer birthdays statistics
router.get('/stats', companyFilter, csrfProtection, async (req, res) => {
  try {
    const { 
      customerGroupId, 
      loyaltyCardId, 
      daysBefore, 
      search 
    } = req.query;

    // Build where clause (same as main route)
    const whereClause = {};

    if (customerGroupId) {
      whereClause.customer_group_id = customerGroupId;
    }

    if (loyaltyCardId) {
      whereClause.loyalty_card_config_id = loyaltyCardId;
    }

    if (daysBefore) {
      whereClause.birthday = {
        [Op.not]: null
      };
    }

    if (search) {
      whereClause[Op.or] = [
        { customer_id: { [Op.iLike]: `%${search}%` } },
        { full_name: { [Op.iLike]: `%${search}%` } },
        { phone_number: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Build final where clause with company filter
    const finalWhereClause = buildCompanyWhere(req, whereClause);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalWhereClause.companyId = req.user.companyId;
    }

    // Fetch all customers for stats calculation
    const customers = await Customer.findAll({
      where: finalWhereClause,
      include: [
        { 
          model: CustomerGroup, 
          as: 'group'
        },
        { 
          model: LoyaltyCardConfig,
          as: 'loyaltyCardConfig'
        }
      ]
    });

    // Calculate stats
    const today = new Date();
    const currentYear = today.getFullYear();
    
    const processedCustomers = customers
      .map(customer => {
        if (!customer.birthday) return null;

        const birthDate = new Date(customer.birthday);
        const birthdayThisYear = new Date(currentYear, birthDate.getMonth(), birthDate.getDate());
        
        if (birthdayThisYear < today) {
          birthdayThisYear.setFullYear(currentYear + 1);
        }

        const daysLeft = Math.ceil((birthdayThisYear - today) / (1000 * 60 * 60 * 24));
        return { ...customer, daysLeft };
      })
      .filter(customer => customer !== null);

    // Apply daysBefore filter
    let filteredCustomers = processedCustomers;
    if (daysBefore) {
      const days = parseInt(daysBefore);
      filteredCustomers = processedCustomers.filter(customer => customer.daysLeft <= days);
    }

    const stats = {
      totalCustomers: filteredCustomers.length,
      upcomingBirthdays: filteredCustomers.filter(c => c.daysLeft <= 30).length,
      thisWeekBirthdays: filteredCustomers.filter(c => c.daysLeft <= 7).length,
      todayBirthdays: filteredCustomers.filter(c => c.daysLeft === 0).length
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching customer birthdays statistics',
      error: error.message
    });
  }
});

module.exports = router;
