const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { 
  Customer, 
  CustomerGroup, 
  Account, 
  LoyaltyCardConfig,
  User 
} = require('../models');
const { Op } = require('sequelize');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get Customer List Report Data
router.get('/', async (req, res) => {
  try {
    const {
      customerGroupId,
      status,
      search,
      sortBy = 'full_name',
      sortOrder = 'asc'
    } = req.query;

    // Build where clause for filtering
    const whereClause = {};

    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { customer_id: { [Op.iLike]: `%${search}%` } },
        { full_name: { [Op.iLike]: `%${search}%` } },
        { phone_number: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { website: { [Op.iLike]: `%${search}%` } },
        { fax: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add customer group filtering
    if (customerGroupId && customerGroupId !== 'all') {
      whereClause.customer_group_id = customerGroupId;
    }

    // Add status filtering
    if (status && status !== 'all') {
      if (status === 'active') {
        whereClause.is_active = true;
      } else if (status === 'inactive') {
        whereClause.is_active = false;
      }
    }

    // Map frontend sort fields to database fields
    const sortFieldMap = {
      'customerId': 'customer_id',
      'fullName': 'full_name',
      'customerGroup': 'customer_group_id',
      'receivableAccount': 'default_receivable_account_id',
      'phone': 'phone_number',
      'email': 'email',
      'website': 'website',
      'fax': 'fax',
      'birthday': 'date_of_birth',
      'loyaltyCard': 'loyalty_card_number',
      'address': 'address',
      'accountBalance': 'account_balance',
      'isActive': 'is_active',
      'createdAt': 'created_at',
      'updatedAt': 'updated_at'
    };
    
    const mappedSortBy = sortFieldMap[sortBy] || sortBy;

    // Build final where clause with company filter
    const finalWhereClause = buildCompanyWhere(req, whereClause);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalWhereClause.companyId = req.user.companyId;
    }

    // Fetch customer data with all required associations
    const customers = await Customer.findAll({
      where: finalWhereClause,
      include: [
        { 
          model: CustomerGroup, 
          as: 'group', 
          attributes: ['id', 'group_name', 'group_code'] 
        },
        { 
          model: Account, 
          as: 'defaultReceivableAccount', 
          attributes: ['id', 'code', 'name', 'type'] 
        },
        { 
          model: LoyaltyCardConfig, 
          as: 'loyaltyCardConfig', 
          attributes: ['id', 'loyalty_card_name'] 
        },
        { 
          model: User, 
          as: 'creator', 
          attributes: ['id', 'username', 'first_name', 'last_name'] 
        },
        { 
          model: User, 
          as: 'updater', 
          attributes: ['id', 'username', 'first_name', 'last_name'] 
        }
      ],
      order: [[mappedSortBy, sortOrder.toUpperCase()]],
      limit: 10000 // Large limit for reports
    });

    // Transform data to match frontend expectations
    const transformedCustomers = customers.map(customer => ({
      id: customer.id,
      customerId: customer.customer_id,
      fullName: customer.full_name,
      customerGroup: customer.group?.group_name || '--',
      customerGroupCode: customer.group?.group_code || '--',
      receivableAccount: customer.defaultReceivableAccount?.name || '--',
      receivableAccountCode: customer.defaultReceivableAccount?.code || '--',
      phone: customer.phone_number || '--',
      email: customer.email || '--',
      website: customer.website || '--',
      fax: customer.fax || '--',
      birthday: customer.birthday ? new Date(customer.birthday).toLocaleDateString() : '--',
      loyaltyCard: customer.loyalty_card_number || '--',
      loyaltyCardPoints: 0, // Will be calculated separately if needed
      loyaltyCardStatus: customer.loyaltyCardConfig?.loyalty_card_name || '--',
      address: customer.address || '--',
      accountBalance: parseFloat(customer.account_balance) || 0,
      isActive: customer.is_active,
      status: customer.is_active ? 'Active' : 'Inactive',
      createdBy: customer.creator ? `${customer.creator.first_name} ${customer.creator.last_name}` : '--',
      createdAt: customer.created_at,
      updatedBy: customer.updater ? `${customer.updater.first_name} ${customer.updater.last_name}` : '--',
      updatedAt: customer.updated_at
    }));

    res.json({
      success: true,
      data: transformedCustomers,
      total: transformedCustomers.length
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch customer list report',
      details: error.message 
    });
  }
});

// Get Customer List Report Statistics
router.get('/stats', async (req, res) => {
  try {
    const {
      customerGroupId,
      status,
      search
    } = req.query;

    // Build where clause for filtering (same as main route)
    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { customer_id: { [Op.iLike]: `%${search}%` } },
        { full_name: { [Op.iLike]: `%${search}%` } },
        { phone_number: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { website: { [Op.iLike]: `%${search}%` } },
        { fax: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (customerGroupId && customerGroupId !== 'all') {
      whereClause.customer_group_id = customerGroupId;
    }

    if (status && status !== 'all') {
      if (status === 'active') {
        whereClause.is_active = true;
      } else if (status === 'inactive') {
        whereClause.is_active = false;
      }
    }

    // Build final where clause with company filter
    const finalWhereClause = buildCompanyWhere(req, whereClause);
    
    // CRITICAL: Ensure companyId is always in the where clause
    if (!req.user.isSystemAdmin && req.user.companyId) {
      finalWhereClause.companyId = req.user.companyId;
    }

    // Get statistics
    const totalCustomers = await Customer.count({ 
      where: finalWhereClause
    });
    const activeCustomers = await Customer.count({ 
      where: { ...finalWhereClause, is_active: true }
    });
    const inactiveCustomers = await Customer.count({ 
      where: { ...finalWhereClause, is_active: false }
    });
    
    // Calculate total account balance
    const totalAccountBalance = await Customer.sum('account_balance', { 
      where: finalWhereClause
    });

    // Get customer group distribution
    const groupDistribution = await Customer.findAll({
      where: finalWhereClause,
      include: [
        { 
          model: CustomerGroup, 
          as: 'group', 
          attributes: ['id', 'group_name'] 
        }
      ],
      attributes: ['customer_group_id'],
      group: ['customer_group_id', 'group.id', 'group.group_name']
    });

    const groupStats = groupDistribution.map(item => ({
      groupName: item.group?.group_name || 'No Group',
      count: 1 // This will be aggregated properly in a real implementation
    }));

    res.json({
      success: true,
      stats: {
        totalCustomers,
        activeCustomers,
        inactiveCustomers,
        totalAccountBalance: totalAccountBalance || 0,
        groupDistribution: groupStats,
        lastUpdate: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch customer list report statistics',
      details: error.message 
    });
  }
});

module.exports = router;
