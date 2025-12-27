/**
 * Company Filter Middleware
 * 
 * This middleware automatically adds companyId filtering to Sequelize queries
 * for multi-tenant data isolation. Super-admins bypass this filtering.
 * 
 * Usage:
 *   - Apply to routes that need company filtering
 *   - Automatically adds `where: { companyId: req.user.companyId }` to queries
 *   - Super-admins can access all companies' data
 */

const { Op } = require('sequelize');

/**
 * Middleware to add company filter to request
 * This adds req.companyFilter which can be used in queries
 */
const companyFilter = (req, res, next) => {
    // Check if user is super-admin
    if (req.user && req.user.isSystemAdmin) {
        // Super-admin can access all data - no filtering
        req.companyFilter = null;
        req.isSuperAdmin = true;
    } else if (req.user && req.user.companyId) {
        // Regular user - filter by their company
        req.companyFilter = { companyId: req.user.companyId };
        req.isSuperAdmin = false;
    } else {
        // User without company (shouldn't happen for regular users)
        // This might be a registration flow or invalid state
        req.companyFilter = null;
        req.isSuperAdmin = false;
    }
    
    next();
};

/**
 * Helper function to build where clause with company filter
 * Can be used in route handlers to ensure company filtering
 */
const buildCompanyWhere = (req, additionalWhere = {}) => {
    // If super-admin, don't filter by company
    if (req.isSuperAdmin) {
        return additionalWhere;
    }
    
    // Otherwise, add company filter
    if (req.companyFilter) {
        // Merge company filter with additional where clause
        // Important: companyId must be at the top level, not inside Op.or
        const merged = {
            ...additionalWhere,
            ...req.companyFilter // companyId goes last to ensure it's always applied
        };
        
        // If additionalWhere has Op.or, we need to ensure companyId is still applied
        // Sequelize will combine them with AND, which is what we want
        return merged;
    }
    
    // If no company filter and not super-admin, return empty (shouldn't happen)
    return additionalWhere;
};

/**
 * Middleware to ensure user has company access
 * Use this to protect routes that require company context
 */
const requireCompany = (req, res, next) => {
    // Super-admin can access without company
    if (req.user && req.user.isSystemAdmin) {
        return next();
    }
    
    // Regular users must have a company
    if (!req.user || !req.user.companyId) {
        return res.status(403).json({
            message: 'Company access required. Please contact your administrator.'
        });
    }
    
    next();
};

/**
 * Middleware to check if user can access a specific company
 * Use this when routes need to verify access to a specific companyId
 */
const canAccessCompany = (req, res, next) => {
    const requestedCompanyId = req.params.companyId || req.body.companyId || req.query.companyId;
    
    // Super-admin can access any company
    if (req.user && req.user.isSystemAdmin) {
        return next();
    }
    
    // Regular users can only access their own company
    if (requestedCompanyId && req.user && req.user.companyId) {
        if (requestedCompanyId !== req.user.companyId) {
            return res.status(403).json({
                message: 'Access denied. You can only access your own company data.'
            });
        }
    }
    
    next();
};

module.exports = {
    companyFilter,
    buildCompanyWhere,
    requireCompany,
    canAccessCompany
};

