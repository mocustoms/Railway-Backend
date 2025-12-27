const express = require('express');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { AdjustmentReason } = require('../models');
const router = express.Router();

// Apply authentication and company filtering
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get adjustment reason statistics
router.get('/', async (req, res) => {
    try {
        // Build company filter
        const baseWhere = buildCompanyWhere(req);
        if (!req.user.isSystemAdmin && req.user.companyId) {
            baseWhere.companyId = req.user.companyId;
        }

        // Get actual stats from database
        const total = await AdjustmentReason.count({ where: baseWhere });
        const active = await AdjustmentReason.count({ 
            where: { ...baseWhere, is_active: true } 
        });
        const inactive = await AdjustmentReason.count({ 
            where: { ...baseWhere, is_active: false } 
        });
        
        // Count by type (with company filter)
        const addType = await AdjustmentReason.count({ 
            where: { ...baseWhere, type: 'add', is_active: true } 
        });
        const deductType = await AdjustmentReason.count({ 
            where: { ...baseWhere, type: 'deduct', is_active: true } 
        });

        const result = {
            total,
            active,
            inactive,
            addType,
            deductType
        };
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;
