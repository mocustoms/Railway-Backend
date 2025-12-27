const { FinancialYear } = require('../models');

/**
 * Middleware to check if a financial year is closed
 * Prevents posting data to closed financial years
 */
const checkFinancialYearOpen = async (req, res, next) => {
    try {
        const { financialYearId, date } = req.body;
        
        // If financialYearId is provided, check that specific year
        if (financialYearId) {
            const financialYear = await FinancialYear.findByPk(financialYearId);
            
            if (!financialYear) {
                return res.status(404).json({ 
                    message: 'Financial year not found' 
                });
            }
            
            if (financialYear.isClosed) {
                return res.status(400).json({ 
                    message: 'Cannot post data to a closed financial year',
                    details: {
                        financialYear: {
                            id: financialYear.id,
                            name: financialYear.name,
                            closedAt: financialYear.closedAt,
                            closingNotes: financialYear.closingNotes
                        }
                    }
                });
            }
        }
        
        // If date is provided, check if that date falls in an open financial year
        if (date) {
            const isInOpenYear = await FinancialYear.isDateInOpenYear(date);
            
            if (!isInOpenYear) {
                const openYear = await FinancialYear.getOpenYearForDate(date);
                
                return res.status(400).json({ 
                    message: 'Cannot post data for this date - no open financial year found',
                    details: {
                        requestedDate: date,
                        availableOpenYear: openYear ? {
                            id: openYear.id,
                            name: openYear.name,
                            startDate: openYear.startDate,
                            endDate: openYear.endDate
                        } : null
                    }
                });
            }
        }
        
        // If neither financialYearId nor date is provided, check current financial year
        if (!financialYearId && !date) {
            const currentYear = await FinancialYear.getCurrentYear();
            
            if (!currentYear) {
                return res.status(400).json({ 
                    message: 'No current financial year found' 
                });
            }
            
            if (currentYear.isClosed) {
                return res.status(400).json({ 
                    message: 'Current financial year is closed',
                    details: {
                        financialYear: {
                            id: currentYear.id,
                            name: currentYear.name,
                            closedAt: currentYear.closedAt,
                            closingNotes: currentYear.closingNotes
                        }
                    }
                });
            }
        }
        
        next();
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Middleware to check if a specific financial year is open
 * Used when you know the specific financial year ID
 */
const checkSpecificFinancialYearOpen = async (req, res, next) => {
    try {
        const { financialYearId } = req.params;
        
        if (!financialYearId) {
            return res.status(400).json({ 
                message: 'Financial year ID is required' 
            });
        }
        
        const financialYear = await FinancialYear.findByPk(financialYearId);
        
        if (!financialYear) {
            return res.status(404).json({ 
                message: 'Financial year not found' 
            });
        }
        
        if (financialYear.isClosed) {
            return res.status(400).json({ 
                message: 'Cannot perform operation on a closed financial year',
                details: {
                    financialYear: {
                        id: financialYear.id,
                        name: financialYear.name,
                        closedAt: financialYear.closedAt,
                        closingNotes: financialYear.closingNotes
                    }
                }
            });
        }
        
        // Add financial year to request for use in subsequent middleware/routes
        req.financialYear = financialYear;
        next();
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Middleware to check if current financial year is open
 * Used for operations that should use the current financial year
 */
const checkCurrentFinancialYearOpen = async (req, res, next) => {
    try {
        const currentYear = await FinancialYear.getCurrentYear();
        
        if (!currentYear) {
            return res.status(400).json({ 
                message: 'No current financial year found' 
            });
        }
        
        if (currentYear.isClosed) {
            return res.status(400).json({ 
                message: 'Current financial year is closed',
                details: {
                    financialYear: {
                        id: currentYear.id,
                        name: currentYear.name,
                        closedAt: currentYear.closedAt,
                        closingNotes: currentYear.closingNotes
                    }
                }
            });
        }
        
        // Add current financial year to request for use in subsequent middleware/routes
        req.currentFinancialYear = currentYear;
        next();
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = {
    checkFinancialYearOpen,
    checkSpecificFinancialYearOpen,
    checkCurrentFinancialYearOpen
}; 