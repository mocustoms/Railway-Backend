const express = require('express');
const router = express.Router();
const { Sequelize, Op } = require('sequelize');
const { FinancialYear, User } = require('../models');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const sequelize = require('../../config/database');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get all financial years
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, search, status, isActive } = req.query;
        const offset = (page - 1) * limit;
        
        // Build where clause - show all financial years by default unless isActive is explicitly set
        let whereClause = {};
        
        // Filter by active status if specified
        if (isActive !== undefined) {
            whereClause.isActive = isActive === 'true';
        }
        
        if (search) {
            whereClause = {
                ...whereClause,
                [Op.or]: [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { description: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }
        
        if (status && status !== 'all') {
            switch (status) {
                case 'open':
                    whereClause = { ...whereClause, isClosed: false };
                    break;
                case 'closed':
                    whereClause = { ...whereClause, isClosed: true };
                    break;
                case 'current':
                    whereClause = { ...whereClause, isCurrent: true };
                    break;
            }
        }
        
        const { count, rows: financialYears } = await FinancialYear.findAndCountAll({
            where: buildCompanyWhere(req, whereClause),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                },
                {
                    model: User,
                    as: 'closer',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'closedBy'
                }
            ],
            order: [['startDate', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        const totalPages = Math.ceil(count / limit);

        res.json({
            data: financialYears,
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages,
            pagination: {
                totalItems: count,
                currentPage: parseInt(page),
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get current financial year
router.get('/current', async (req, res) => {
    try {
        const currentYear = await FinancialYear.getCurrentYear();
        
        if (!currentYear) {
            return res.status(404).json({ message: 'No current financial year found' });
        }

        const yearWithCreator = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: currentYear.id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                },
                {
                    model: User,
                    as: 'closer',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'closedBy'
                }
            ]
        });

        res.json(yearWithCreator);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get financial year by ID
router.get('/:id', async (req, res) => {
    try {
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: req.params.id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                },
                {
                    model: User,
                    as: 'closer',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'closedBy'
                }
            ]
        });

        if (!financialYear) {
            return res.status(404).json({ message: 'Financial year not found' });
        }

        res.json(financialYear);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create new financial year
router.post('/', csrfProtection, async (req, res) => {
    try {
        const { name, startDate, endDate, description } = req.body;

        // Validate required fields
        if (!name || !startDate || !endDate) {
            return res.status(400).json({ 
                message: 'Name, start date, and end date are required' 
            });
        }

        // Validate date range
        if (new Date(startDate) >= new Date(endDate)) {
            return res.status(400).json({ 
                message: 'End date must be after start date' 
            });
        }

        // Check if financial year name already exists in this company
        // Always check within company, even for super-admins
        if (!req.user || !req.user.companyId) {
            console.error('Financial Year Create - Missing companyId:', {
                userId: req.user?.id,
                companyId: req.user?.companyId,
                isSystemAdmin: req.user?.isSystemAdmin
            });
            return res.status(400).json({ 
                message: 'Company ID is required to create a financial year' 
            });
        }

        const trimmedName = name.trim();

        // Use case-insensitive comparison and explicit companyId
        // CRITICAL: Use raw SQL to ensure companyId filter is absolutely enforced
        const existingYearResults = await sequelize.query(
            `SELECT id, name, "startDate", "endDate", "companyId", "isActive", "isCurrent", "isClosed"
             FROM financial_years 
             WHERE LOWER(name) = LOWER(:name) 
             AND "companyId" = :companyId
             LIMIT 1`,
            {
                replacements: {
                    name: trimmedName,
                    companyId: req.user.companyId
                },
                type: sequelize.QueryTypes.SELECT
            }
        );
        
        const existingYearByName = existingYearResults && existingYearResults.length > 0 
            ? await FinancialYear.findByPk(existingYearResults[0].id)
            : null;
        
        // Additional verification: Check what was actually found
        if (existingYearByName) {
            // If companyIds don't match, this is a bug - should not happen
            if (existingYearByName.companyId !== req.user.companyId) {
                // Still return error but with warning
                return res.status(400).json({ 
                    message: 'A financial year with this name already exists in your company',
                    error: 'Duplicate check found record from different company (this should not happen)',
                    details: {
                        existingYear: {
                            id: existingYearByName.id,
                            name: existingYearByName.name,
                            companyId: existingYearByName.companyId
                        },
                        requestedCompanyId: req.user.companyId,
                        warning: 'Database query returned record from different company. This indicates a bug in the query.'
                    }
                });
            }
        }

        if (existingYearByName) {
            return res.status(400).json({ 
                message: 'A financial year with this name already exists in your company',
                details: {
                    existingYear: {
                        id: existingYearByName.id,
                        name: existingYearByName.name,
                        startDate: existingYearByName.startDate,
                        endDate: existingYearByName.endDate,
                        companyId: existingYearByName.companyId
                    },
                    requestedCompanyId: req.user.companyId,
                    debug: {
                        existingCompanyId: existingYearByName.companyId,
                        userCompanyId: req.user.companyId,
                        match: existingYearByName.companyId === req.user.companyId
                    }
                }
            });
        }

        // Check for overlapping financial years in this company
        const overlappingYear = await FinancialYear.findOne({
            where: {
                companyId: req.user.companyId,
                isActive: true,
                [Op.or]: [
                    {
                        startDate: { [Op.lte]: endDate },
                        endDate: { [Op.gte]: startDate }
                    }
                ]
            }
        });

        if (overlappingYear) {
            return res.status(400).json({ 
                message: 'Financial year dates overlap with existing year in your company',
                details: {
                    overlappingYear: {
                        id: overlappingYear.id,
                        name: overlappingYear.name,
                        startDate: overlappingYear.startDate,
                        endDate: overlappingYear.endDate,
                        companyId: overlappingYear.companyId
                    },
                    requestedCompanyId: req.user.companyId
                }
            });
        }

        // Create financial year
        const financialYear = await FinancialYear.create({
            companyId: req.user.companyId,
            name,
            startDate,
            endDate,
            description,
            createdBy: req.user.id
        });

        const createdYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: financialYear.id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                }
            ]
        });

        res.status(201).json(createdYear);
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            // Database constraint caught a duplicate - this should not happen if our check worked
            console.error('Financial Year Create - Database constraint error (unexpected):', {
                error: error.message,
                errors: error.errors,
                companyId: req.user?.companyId,
                name: req.body?.name,
                constraint: error.errors?.[0]?.path || 'name'
            });
            
            // Try to find the existing record to show proper error
            if (req.user?.companyId && req.body?.name) {
                const existing = await FinancialYear.findOne({
                    where: {
                        name: req.body.name.trim(),
                        companyId: req.user.companyId
                    }
                });
                
                if (existing) {
                    return res.status(400).json({ 
                        message: 'A financial year with this name already exists in your company',
                        error: 'Duplicate entry',
                        details: {
                            existingYear: {
                                id: existing.id,
                                name: existing.name,
                                companyId: existing.companyId
                            },
                            requestedCompanyId: req.user.companyId,
                            constraint: error.errors?.[0]?.path || 'name'
                        }
                    });
                }
            }
            
            return res.status(400).json({ 
                message: 'A financial year with this name already exists in your company',
                error: 'Duplicate entry',
                details: {
                    constraint: error.errors?.[0]?.path || 'name',
                    companyId: req.user?.companyId,
                    note: 'This error was caught by database constraint. Please check companyId is set correctly.'
                }
            });
        }
        
        console.error('Error creating financial year:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update financial year
router.put('/:id', csrfProtection, async (req, res) => {
    try {
        const { name, startDate, endDate, description } = req.body;
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!financialYear) {
            return res.status(404).json({ message: 'Financial year not found' });
        }

        // Validate required fields
        if (!name || !startDate || !endDate) {
            return res.status(400).json({ 
                message: 'Name, start date, and end date are required' 
            });
        }

        // Validate date range
        if (new Date(startDate) >= new Date(endDate)) {
            return res.status(400).json({ 
                message: 'End date must be after start date' 
            });
        }

        // Check if financial year name already exists in this company (excluding current year)
        // Always check within company, even for super-admins
        if (!req.user.companyId) {
            return res.status(400).json({ 
                message: 'Company ID is required to update a financial year' 
            });
        }

        // Use the financialYear.id from the database query to ensure correct comparison
        const currentYearId = financialYear.id;

        const existingYearByName = await FinancialYear.findOne({
            where: {
                id: { [Op.ne]: currentYearId },
                name: name.trim(),
                companyId: req.user.companyId
            }
        });

        if (existingYearByName) {
            return res.status(400).json({ 
                message: 'A financial year with this name already exists in your company',
                details: {
                    existingYear: {
                        id: existingYearByName.id,
                        name: existingYearByName.name,
                        startDate: existingYearByName.startDate,
                        endDate: existingYearByName.endDate,
                        companyId: existingYearByName.companyId
                    },
                    requestedCompanyId: req.user.companyId,
                    currentYearId: currentYearId
                }
            });
        }

        // Check for overlapping financial years in this company (excluding current year)
        const overlappingYear = await FinancialYear.findOne({
            where: {
                id: { [Op.ne]: currentYearId },
                companyId: req.user.companyId,
                isActive: true,
                [Op.or]: [
                    {
                        startDate: { [Op.lte]: endDate },
                        endDate: { [Op.gte]: startDate }
                    }
                ]
            }
        });

        if (overlappingYear) {
            return res.status(400).json({ 
                message: 'Financial year dates overlap with existing year in your company',
                details: {
                    overlappingYear: {
                        id: overlappingYear.id,
                        name: overlappingYear.name,
                        startDate: overlappingYear.startDate,
                        endDate: overlappingYear.endDate,
                        companyId: overlappingYear.companyId
                    },
                    requestedCompanyId: req.user.companyId
                }
            });
        }

        // Update financial year
        await financialYear.update({
            name,
            startDate,
            endDate,
            description,
            updatedBy: req.user.id
        });

        const updatedYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: financialYear.id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                }
            ]
        });

        res.json(updatedYear);
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ message: 'Financial year name already exists' });
        }
        
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Set current financial year
router.post('/:id/set-current', csrfProtection, async (req, res) => {
    try {
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!financialYear) {
            return res.status(404).json({ message: 'Financial year not found' });
        }

        if (!financialYear.isActive) {
            return res.status(400).json({ message: 'Cannot set inactive financial year as current' });
        }

        // Set as current year
        await FinancialYear.setCurrentYear(req.params.id);

        // Update the updatedBy field
        await financialYear.update({ updatedBy: req.user.id });

        const updatedYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: financialYear.id }),
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                }
            ]
        });

        res.json(updatedYear);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete financial year (soft delete)
router.delete('/:id', csrfProtection, async (req, res) => {
    try {
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!financialYear) {
            return res.status(404).json({ message: 'Financial year not found' });
        }

        // Check if it's the current year
        if (financialYear.isCurrent) {
            return res.status(400).json({ 
                message: 'Cannot delete the current financial year. Set another year as current first.' 
            });
        }

        // Check for references in other tables
        const references = await checkFinancialYearReferences(financialYear.id);
        
        if (references.hasReferences) {
            return res.status(400).json({ 
                message: 'Cannot delete financial year because it is referenced in other parts of the system.',
                references: references.details,
                suggestion: 'Consider deactivating the financial year instead of deleting it.'
            });
        }

        // Hard delete (actually remove from database)
        await financialYear.destroy();

        res.json({ message: 'Financial year deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Force delete financial year (admin only)
router.delete('/:id/force', csrfProtection, async (req, res) => {
    try {
        // Check if user has admin privileges
        if (req.user.role !== 'admin') {
            return res.status(403).json({ 
                message: 'Only administrators can force delete financial years' 
            });
        }

        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!financialYear) {
            return res.status(404).json({ message: 'Financial year not found' });
        }

        // Check if it's the current year
        if (financialYear.isCurrent) {
            return res.status(400).json({ 
                message: 'Cannot delete the current financial year. Set another year as current first.' 
            });
        }

        // Check for references in other tables
        const references = await checkFinancialYearReferences(financialYear.id);
        
        if (references.hasReferences) {
            return res.status(400).json({ 
                message: 'Cannot force delete financial year because it is referenced in other parts of the system.',
                references: references.details,
                warning: 'Force deletion would break data integrity. Please resolve references first.'
            });
        }

        // Hard delete
        await financialYear.destroy();

        res.json({ message: 'Financial year permanently deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Helper function to check for financial year references
async function checkFinancialYearReferences(financialYearId) {
    const references = {
        hasReferences: false,
        details: {}
    };

    try {
        // Check opening balances (if they reference financial years in the future)
        const openingBalancesCount = await sequelize.query(`
            SELECT COUNT(*) as count FROM "openingBalances" 
            WHERE "financialYearId" = :financialYearId
        `, {
            replacements: { financialYearId },
            type: Sequelize.QueryTypes.SELECT
        });

        if (openingBalancesCount[0].count > 0) {
            references.hasReferences = true;
            references.details.openingBalances = {
                count: openingBalancesCount[0].count,
                message: 'Opening balances are linked to this financial year'
            };
        }

        // Check transactions (if they reference financial years in the future)
        const transactionsCount = await sequelize.query(`
            SELECT COUNT(*) as count FROM transactions 
            WHERE "financialYearId" = :financialYearId
        `, {
            replacements: { financialYearId },
            type: Sequelize.QueryTypes.SELECT
        });

        if (transactionsCount[0].count > 0) {
            references.hasReferences = true;
            references.details.transactions = {
                count: transactionsCount[0].count,
                message: 'Transactions are linked to this financial year'
            };
        }

        // Check journal entries (if they reference financial years in the future)
        const journalEntriesCount = await sequelize.query(`
            SELECT COUNT(*) as count FROM journal_entries 
            WHERE "financialYearId" = :financialYearId
        `, {
            replacements: { financialYearId },
            type: Sequelize.QueryTypes.SELECT
        });

        if (journalEntriesCount[0].count > 0) {
            references.hasReferences = true;
            references.details.journalEntries = {
                count: journalEntriesCount[0].count,
                message: 'Journal entries are linked to this financial year'
            };
        }

        // Check reports (if they reference financial years in the future)
        const reportsCount = await sequelize.query(`
            SELECT COUNT(*) as count FROM reports 
            WHERE "financialYearId" = :financialYearId
        `, {
            replacements: { financialYearId },
            type: Sequelize.QueryTypes.SELECT
        });

        if (reportsCount[0].count > 0) {
            references.hasReferences = true;
            references.details.reports = {
                count: reportsCount[0].count,
                message: 'Reports are linked to this financial year'
            };
        }

        // Check budgets (if they reference financial years in the future)
        const budgetsCount = await sequelize.query(`
            SELECT COUNT(*) as count FROM budgets 
            WHERE "financialYearId" = :financialYearId
        `, {
            replacements: { financialYearId },
            type: Sequelize.QueryTypes.SELECT
        });

        if (budgetsCount[0].count > 0) {
            references.hasReferences = true;
            references.details.budgets = {
                count: budgetsCount[0].count,
                message: 'Budgets are linked to this financial year'
            };
        }

    } catch (error) {
        // If table doesn't exist, ignore the error
        
    }

    return references;
}

// Get financial year for a specific date
router.get('/date/:date', async (req, res) => {
    try {
        const { date } = req.params;
        
        if (!date || isNaN(Date.parse(date))) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        const financialYear = await FinancialYear.getYearForDate(date);
        
        if (!financialYear) {
            return res.status(404).json({ message: 'No financial year found for the specified date' });
        }

        const yearWithCreator = await FinancialYear.findByPk(financialYear.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                }
            ]
        });

        res.json(yearWithCreator);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Check if financial year name exists
router.get('/check-name', async (req, res) => {
    try {
        const { name } = req.query;
        
        if (!name) {
            return res.status(400).json({ message: 'Name parameter is required' });
        }

        const existingYear = await FinancialYear.findOne({
            where: {
                name: name,
                isActive: true
            }
        });

        res.json({ 
            exists: !!existingYear,
            existingYear: existingYear ? {
                id: existingYear.id,
                name: existingYear.name,
                startDate: existingYear.startDate,
                endDate: existingYear.endDate
            } : null
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Check if date range overlaps with existing financial years
router.get('/check-overlap', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Start date and end date parameters are required' });
        }

        // Validate date range
        if (new Date(startDate) >= new Date(endDate)) {
            return res.status(400).json({ 
                message: 'End date must be after start date',
                overlaps: false
            });
        }

        const overlappingYear = await FinancialYear.findOne({
            where: {
                isActive: true,
                [Op.or]: [
                    {
                        startDate: { [Op.lte]: endDate },
                        endDate: { [Op.gte]: startDate }
                    }
                ]
            }
        });

        res.json({ 
            overlaps: !!overlappingYear,
            overlappingYear: overlappingYear ? {
                id: overlappingYear.id,
                name: overlappingYear.name,
                startDate: overlappingYear.startDate,
                endDate: overlappingYear.endDate
            } : null
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Close financial year
router.post('/:id/close', csrfProtection, async (req, res) => {
    try {
        const { notes } = req.body;
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!financialYear) {
            return res.status(404).json({ message: 'Financial year not found' });
        }

        // Check if it can be closed
        const canClose = await financialYear.canBeClosed();
        if (!canClose) {
            return res.status(400).json({ 
                message: 'Financial year cannot be closed. It may be the current year, already closed, inactive, or the end date has not passed.' 
            });
        }

        // Close the financial year
        await financialYear.close(req.user.id, notes);

        const closedYear = await FinancialYear.findByPk(financialYear.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                },
                {
                    model: User,
                    as: 'closer',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'closedBy'
                }
            ]
        });

        res.json({
            message: 'Financial year closed successfully',
            financialYear: closedYear
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Internal server error',
            details: error.message 
        });
    }
});

// Reopen financial year (admin only)
router.post('/:id/reopen', csrfProtection, async (req, res) => {
    try {
        // Check if user has admin privileges
        if (req.user.role !== 'admin') {
            return res.status(403).json({ 
                message: 'Only administrators can reopen financial years' 
            });
        }

        const { notes } = req.body;
        const financialYear = await FinancialYear.findOne({
            where: buildCompanyWhere(req, { id: req.params.id })
        });

        if (!financialYear) {
            return res.status(404).json({ message: 'Financial year not found' });
        }

        if (!financialYear.isClosed) {
            return res.status(400).json({ 
                message: 'Financial year is not closed and cannot be reopened.' 
            });
        }

        // Reopen the financial year
        await financialYear.reopen(req.user.id, notes);

        const reopenedYear = await FinancialYear.findByPk(financialYear.id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                }
            ]
        });

        res.json({
            message: 'Financial year reopened successfully',
            financialYear: reopenedYear
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get open financial years
router.get('/open', async (req, res) => {
    try {
        const openYears = await FinancialYear.getOpenYears();
        res.json(openYears);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get closed financial years
router.get('/closed', async (req, res) => {
    try {
        const closedYears = await FinancialYear.getClosedYears();
        res.json(closedYears);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Check if date is in open financial year
router.get('/check-date/:date', async (req, res) => {
    try {
        const { date } = req.params;
        
        if (!date || isNaN(Date.parse(date))) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        const isInOpenYear = await FinancialYear.isDateInOpenYear(date);
        const openYear = await FinancialYear.getOpenYearForDate(date);
        
        res.json({
            isInOpenYear,
            openYear: openYear ? {
                id: openYear.id,
                name: openYear.name,
                startDate: openYear.startDate,
                endDate: openYear.endDate
            } : null
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get financial year statistics
router.get('/stats', async (req, res) => {
    try {
        // Build base where clause with company filter
        const baseWhere = {
            isActive: true,
            ...buildCompanyWhere(req)
        };
        if (!req.user.isSystemAdmin && req.user.companyId) {
            baseWhere.companyId = req.user.companyId;
        }

        const totalYears = await FinancialYear.count({ where: baseWhere });
        const openYears = await FinancialYear.count({ 
            where: { ...baseWhere, isClosed: false } 
        });
        const closedYears = await FinancialYear.count({ 
            where: { ...baseWhere, isClosed: true } 
        });
        
        // Get current year with company filter
        const currentYearWhere = {
            isCurrent: true,
            isActive: true,
            ...buildCompanyWhere(req)
        };
        if (!req.user.isSystemAdmin && req.user.companyId) {
            currentYearWhere.companyId = req.user.companyId;
        }
        const currentYear = await FinancialYear.findOne({ where: currentYearWhere });

        res.json({
            totalYears,
            openYears,
            closedYears,
            currentYear: currentYear ? {
                id: currentYear.id,
                name: currentYear.name,
                startDate: currentYear.startDate,
                endDate: currentYear.endDate,
                isCurrent: currentYear.isCurrent,
                isActive: currentYear.isActive,
                isClosed: currentYear.isClosed,
                description: currentYear.description,
                closedAt: currentYear.closedAt,
                closingNotes: currentYear.closingNotes,
                createdBy: currentYear.createdBy,
                updatedBy: currentYear.updatedBy,
                createdAt: currentYear.createdAt,
                updatedAt: currentYear.updatedAt,
                creator: currentYear.creator,
                updater: currentYear.updater,
                closer: currentYear.closer
            } : null
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Export financial years to Excel
router.get('/export/excel', async (req, res) => {
    try {
        const { search, status } = req.query;
        
        // Build where clause
        let whereClause = { isActive: true };
        
        if (search) {
            whereClause = {
                ...whereClause,
                [Op.or]: [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { description: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }
        
        if (status && status !== 'all') {
            switch (status) {
                case 'open':
                    whereClause = { ...whereClause, isClosed: false };
                    break;
                case 'closed':
                    whereClause = { ...whereClause, isClosed: true };
                    break;
                case 'current':
                    whereClause = { ...whereClause, isCurrent: true };
                    break;
            }
        }
        
        const financialYears = await FinancialYear.findAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                },
                {
                    model: User,
                    as: 'closer',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'closedBy'
                }
            ],
            order: [['startDate', 'DESC']]
        });

        // Create Excel workbook
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Financial Years');

        // Add headers
        worksheet.columns = [
            { header: 'Name', key: 'name', width: 20 },
            { header: 'Start Date', key: 'startDate', width: 15 },
            { header: 'End Date', key: 'endDate', width: 15 },
            { header: 'Description', key: 'description', width: 30 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Current Year', key: 'isCurrent', width: 15 },
            { header: 'Closed Date', key: 'closedAt', width: 15 },
            { header: 'Closed By', key: 'closedBy', width: 20 },
            { header: 'Closing Notes', key: 'closingNotes', width: 30 },
            { header: 'Created By', key: 'createdBy', width: 20 },
            { header: 'Created Date', key: 'createdAt', width: 15 },
            { header: 'Updated By', key: 'updatedBy', width: 20 },
            { header: 'Updated Date', key: 'updatedAt', width: 15 }
        ];

        // Add data
        financialYears.forEach((year, index) => {
            worksheet.addRow({
                name: year.name,
                startDate: new Date(year.startDate).toLocaleDateString(),
                endDate: new Date(year.endDate).toLocaleDateString(),
                description: year.description || '',
                status: year.isClosed ? 'Closed' : year.isCurrent ? 'Current' : 'Open',
                isCurrent: year.isCurrent ? 'Yes' : 'No',
                closedAt: year.closedAt ? new Date(year.closedAt).toLocaleDateString() : '',
                closedBy: year.closer ? `${year.closer.first_name} ${year.closer.last_name}` : '',
                closingNotes: year.closingNotes || '',
                createdBy: year.creator ? `${year.creator.first_name} ${year.creator.last_name}` : '',
                createdAt: new Date(year.createdAt).toLocaleDateString(),
                updatedBy: year.updater ? `${year.updater.first_name} ${year.updater.last_name}` : '',
                updatedAt: new Date(year.updatedAt).toLocaleDateString()
            });
        });

        // Style headers
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=financial-years-${new Date().toISOString().split('T')[0]}.xlsx`);

        // Write to response
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', details: error.message });
    }
});

// Export financial years to PDF
router.get('/export/pdf', async (req, res) => {
    try {
        const { search, status } = req.query;
        
        // Build where clause
        let whereClause = { isActive: true };
        
        if (search) {
            whereClause = {
                ...whereClause,
                [Op.or]: [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { description: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }
        
        if (status && status !== 'all') {
            switch (status) {
                case 'open':
                    whereClause = { ...whereClause, isClosed: false };
                    break;
                case 'closed':
                    whereClause = { ...whereClause, isClosed: true };
                    break;
                case 'current':
                    whereClause = { ...whereClause, isCurrent: true };
                    break;
            }
        }
        
        const financialYears = await FinancialYear.findAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'createdBy'
                },
                {
                    model: User,
                    as: 'updater',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'updatedBy'
                },
                {
                    model: User,
                    as: 'closer',
                    attributes: ['id', 'first_name', 'last_name'],
                    foreignKey: 'closedBy'
                }
            ],
            order: [['startDate', 'DESC']]
        });

        // Create PDF
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument();

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=financial-years-${new Date().toISOString().split('T')[0]}.pdf`);

        // Pipe PDF to response
        doc.pipe(res);

        // Add title
        doc.fontSize(20).text('Financial Years Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(2);

        // Add table headers
        const headers = ['Name', 'Start Date', 'End Date', 'Status', 'Current'];
        const columnWidths = [120, 80, 80, 60, 60];
        let yPosition = doc.y;

        headers.forEach((header, index) => {
            doc.fontSize(10).font('Helvetica-Bold')
               .text(header, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition, {
                   width: columnWidths[index],
                   align: 'left'
               });
        });

        yPosition += 20;
        doc.moveTo(50, yPosition).lineTo(50 + columnWidths.reduce((a, b) => a + b, 0), yPosition).stroke();
        yPosition += 10;

        // Add data rows
        financialYears.forEach((year, rowIndex) => {
            if (yPosition > 700) {
                doc.addPage();
                yPosition = 50;
            }

            const rowData = [
                year.name,
                new Date(year.startDate).toLocaleDateString(),
                new Date(year.endDate).toLocaleDateString(),
                year.isClosed ? 'Closed' : year.isCurrent ? 'Current' : 'Open',
                year.isCurrent ? 'Yes' : 'No'
            ];

            rowData.forEach((cell, index) => {
                doc.fontSize(9).font('Helvetica')
                   .text(cell, 50 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), yPosition, {
                       width: columnWidths[index],
                       align: 'left'
                   });
            });

            yPosition += 15;
        });

        // Finalize PDF
        doc.end();
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router; 