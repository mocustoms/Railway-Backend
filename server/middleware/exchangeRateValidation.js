const { body, param, query, validationResult } = require('express-validator');

// Validation middleware for exchange rates
const validateExchangeRate = [
    body('from_currency_id')
        .isUUID()
        .withMessage('From currency ID must be a valid UUID'),
    
    body('to_currency_id')
        .isUUID()
        .withMessage('To currency ID must be a valid UUID'),
    
    body('rate')
        .isFloat({ min: 0.000001, max: 999999.999999 })
        .withMessage('Rate must be a positive number between 0.000001 and 999999.999999'),
    
    body('effective_date')
        .optional()
        .isISO8601()
        .withMessage('Effective date must be a valid date'),
    
    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean value'),
    
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];

const validateExchangeRateUpdate = [
    param('id')
        .isUUID()
        .withMessage('Exchange rate ID must be a valid UUID'),
    
    body('from_currency_id')
        .optional()
        .isUUID()
        .withMessage('From currency ID must be a valid UUID'),
    
    body('to_currency_id')
        .optional()
        .isUUID()
        .withMessage('To currency ID must be a valid UUID'),
    
    body('rate')
        .optional()
        .isFloat({ min: 0.000001, max: 999999.999999 })
        .withMessage('Rate must be a positive number between 0.000001 and 999999.999999'),
    
    body('effective_date')
        .optional()
        .isISO8601()
        .withMessage('Effective date must be a valid date'),
    
    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean value'),
    
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];

const validateExchangeRateId = [
    param('id')
        .isUUID()
        .withMessage('Exchange rate ID must be a valid UUID'),
    
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];

const validateCurrencyConversion = [
    query('from_currency_id')
        .isUUID()
        .withMessage('From currency ID must be a valid UUID'),
    
    query('to_currency_id')
        .isUUID()
        .withMessage('To currency ID must be a valid UUID'),
    
    query('amount')
        .optional()
        .isFloat({ min: 0.000001 })
        .withMessage('Amount must be a positive number'),
    
    query('date')
        .optional()
        .isISO8601()
        .withMessage('Date must be a valid date'),
    
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];

const validateBulkExchangeRates = [
    body('exchange_rates')
        .isArray({ min: 1, max: 100 })
        .withMessage('Exchange rates must be an array with 1-100 items'),
    
    body('exchange_rates.*.from_currency_id')
        .isUUID()
        .withMessage('From currency ID must be a valid UUID'),
    
    body('exchange_rates.*.to_currency_id')
        .isUUID()
        .withMessage('To currency ID must be a valid UUID'),
    
    body('exchange_rates.*.rate')
        .isFloat({ min: 0.000001, max: 999999.999999 })
        .withMessage('Rate must be a positive number between 0.000001 and 999999.999999'),
    
    body('exchange_rates.*.effective_date')
        .optional()
        .isISO8601()
        .withMessage('Effective date must be a valid date'),
    
    body('exchange_rates.*.is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean value'),
    
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];

const validateExchangeRateHistory = [
    param('from_currency_id')
        .isUUID()
        .withMessage('From currency ID must be a valid UUID'),
    
    param('to_currency_id')
        .isUUID()
        .withMessage('To currency ID must be a valid UUID'),
    
    query('limit')
        .optional()
        .isInt({ min: 1, max: 1000 })
        .withMessage('Limit must be an integer between 1 and 1000'),
    
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];

const validateToggleStatus = [
    param('id')
        .isUUID()
        .withMessage('Exchange rate ID must be a valid UUID'),
    
    body('is_active')
        .isBoolean()
        .withMessage('is_active must be a boolean value'),
    
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];

module.exports = {
    validateExchangeRate,
    validateExchangeRateUpdate,
    validateExchangeRateId,
    validateCurrencyConversion,
    validateBulkExchangeRates,
    validateExchangeRateHistory,
    validateToggleStatus
}; 