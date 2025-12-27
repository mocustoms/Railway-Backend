/**
 * Auto Code Generation Service
 * 
 * This service handles automatic code generation for all modules using the AutoCode system.
 * It ensures:
 * - Codes are generated sequentially per company
 * - Codes respect unique constraints (code + companyId)
 * - AutoCode counters are incremented atomically
 * - Fallback logic if AutoCode is not configured
 */

const { Op } = require('sequelize');
const AutoCode = require('../models/autoCode');

/**
 * Generate and reserve the next code for a module
 * This function:
 * 1. Finds the AutoCode configuration for the module (filtered by companyId)
 * 2. Generates the code using the format
 * 3. Increments the next_number atomically
 * 4. Returns the generated code
 * 
 * @param {string} moduleName - Name of the module (e.g., 'products', 'customers')
 * @param {string} companyId - Company ID for multi-tenant isolation
 * @param {object} options - Optional configuration
 * @param {object} options.transaction - Database transaction for atomicity
 * @param {object} options.fallbackPrefix - Fallback prefix if AutoCode not configured
 * @param {object} options.fallbackFormat - Fallback format if AutoCode not configured
 * @returns {Promise<string>} Generated code
 */
async function generateNextCode(moduleName, companyId, options = {}) {
    const { transaction, fallbackPrefix, fallbackFormat, companyCode } = options;
    
    try {
        // Find active AutoCode configuration for this module and company
        const autoCode = await AutoCode.findOne({
            where: {
                module_name: moduleName,
                companyId: companyId,
                status: 'active'
            },
            transaction
        });

        if (autoCode) {
            // Use AutoCode configuration
            const code = generateCodeFromConfig(autoCode, companyCode);
            
            // Atomically increment next_number
            await autoCode.increment('next_number', {
                by: 1,
                transaction
            });
            
            // Update last_used timestamp
            await autoCode.update({
                last_used: new Date()
            }, { transaction });

            return code;
        } else {
            // Fallback: Generate simple sequential code
            if (fallbackPrefix && fallbackFormat) {
                return await generateFallbackCode(moduleName, companyId, fallbackPrefix, fallbackFormat, transaction, companyCode);
            }
            
            // Default fallback: Simple incremental number
            return await generateSimpleFallbackCode(moduleName, companyId, transaction, companyCode, fallbackPrefix);
        }
    } catch (error) {
        throw new Error(`Failed to generate code for ${moduleName}: ${error.message}`);
    }
}

/**
 * Generate code from AutoCode configuration
 */
function generateCodeFromConfig(autoCode, companyCode = null) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const paddedNumber = String(autoCode.next_number).padStart(autoCode.number_padding, '0');

    let code = autoCode.format;
    
    code = code.replace(/{PREFIX}/g, autoCode.prefix);
    code = code.replace(/{YEAR}/g, year);
    code = code.replace(/{MONTH}/g, month);
    code = code.replace(/{DAY}/g, day);
    code = code.replace(/{NUMBER}/g, paddedNumber);
    
    // Replace company code placeholder if provided
    if (companyCode && code.includes('{COMPANY_CODE}')) {
        code = code.replace(/{COMPANY_CODE}/g, companyCode.toUpperCase());
    }

    return code;
}

/**
 * Generate fallback code using prefix and format
 */
async function generateFallbackCode(moduleName, companyId, prefix, format, transaction, companyCode = null) {
    // Try to find the last code with this prefix to determine next number
    // This is module-specific logic
    const Model = getModelForModule(moduleName);
    if (!Model) {
        return generateSimpleFallbackCode(moduleName, companyId, transaction);
    }

    const codeField = getCodeFieldForModule(moduleName);
    
    // Build search pattern - if company code is used, search for codes starting with company code
    let searchPattern = `${prefix}%`;
    if (companyCode && format.includes('{COMPANY_CODE}')) {
        searchPattern = `${companyCode.toUpperCase()}-${prefix}%`;
    }
    
    // Find all records with this prefix to extract the highest number
    // This ensures sequential numbering even if old codes had dates
    // IMPORTANT: Filter by companyId to ensure codes are unique per company
    const allRecords = await Model.findAll({
        where: {
            companyId: companyId,
            [codeField]: {
                [Op.like]: searchPattern
            }
        },
        attributes: [codeField],
        transaction
    });

    let nextNumber = 1;
    let maxNumber = 0;
    
    // Extract all numbers from existing codes and find the maximum
    for (const record of allRecords) {
        if (record[codeField]) {
            // Extract the last number sequence from the code
            // This handles both formats: CUST-0001 and CUST-20251110-0001
            const matches = String(record[codeField]).match(/(\d+)$/);
            if (matches) {
                const num = parseInt(matches[1]);
                if (num > maxNumber) {
                    maxNumber = num;
                }
            }
        }
    }
    
    if (maxNumber > 0) {
        nextNumber = maxNumber + 1;
    }

    // Use the format provided, but only replace placeholders that exist in the format
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const paddedNumber = String(nextNumber).padStart(4, '0');

    let code = format;
    code = code.replace(/{PREFIX}/g, prefix);
    
    // Only replace date placeholders if they exist in the format
    if (code.includes('{YEAR}')) {
        code = code.replace(/{YEAR}/g, year);
    }
    if (code.includes('{MONTH}')) {
        code = code.replace(/{MONTH}/g, month);
    }
    if (code.includes('{DAY}')) {
        code = code.replace(/{DAY}/g, day);
    }
    code = code.replace(/{NUMBER}/g, paddedNumber);
    
    // Replace company code placeholder if provided
    if (companyCode && code.includes('{COMPANY_CODE}')) {
        code = code.replace(/{COMPANY_CODE}/g, companyCode.toUpperCase());
    }

    // Final check: verify the generated code doesn't already exist for this company
    // This handles race conditions and ensures uniqueness
    const existingCode = await Model.findOne({
        where: {
            companyId: companyId,
            [codeField]: code
        },
        transaction
    });

    if (existingCode) {
        // Code exists, increment and regenerate
        nextNumber++;
        const newPaddedNumber = String(nextNumber).padStart(4, '0');
        code = format;
        code = code.replace(/{PREFIX}/g, prefix);
        if (code.includes('{YEAR}')) code = code.replace(/{YEAR}/g, year);
        if (code.includes('{MONTH}')) code = code.replace(/{MONTH}/g, month);
        if (code.includes('{DAY}')) code = code.replace(/{DAY}/g, day);
        code = code.replace(/{NUMBER}/g, newPaddedNumber);
        if (companyCode && code.includes('{COMPANY_CODE}')) {
            code = code.replace(/{COMPANY_CODE}/g, companyCode.toUpperCase());
        }
    }

    return code;
}

/**
 * Generate simple fallback code (just incremental number)
 */
async function generateSimpleFallbackCode(moduleName, companyId, transaction, companyCode = null, fallbackPrefix = null) {
    const Model = getModelForModule(moduleName);
    if (!Model) {
        // Ultimate fallback: try to use prefix if available
        if (fallbackPrefix && companyCode) {
            return `${companyCode.toUpperCase()}-${fallbackPrefix}-0001`;
        }
        // Last resort: timestamp-based code
        return `${moduleName.toUpperCase()}-${Date.now()}`;
    }

    const codeField = getCodeFieldForModule(moduleName);
    
    // Find all records to extract the highest number
    // This ensures sequential numbering even if old codes had dates
    // IMPORTANT: Filter by companyId to ensure codes are unique per company
    const allRecords = await Model.findAll({
        where: {
            companyId: companyId
        },
        attributes: [codeField],
        transaction
    });

    let nextNumber = 1;
    let maxNumber = 0;
    
    // Extract all numbers from existing codes and find the maximum
    for (const record of allRecords) {
        if (record[codeField]) {
            // Extract the last number sequence from the code
            // This handles both formats: CUST-0001 and CUST-20251110-0001
            const matches = String(record[codeField]).match(/(\d+)$/);
            if (matches) {
                const num = parseInt(matches[1]);
                if (num > maxNumber) {
                    maxNumber = num;
                }
            } else {
                // If no number found, try to parse the whole code as a number
                const num = parseInt(record[codeField]);
                if (!isNaN(num) && num > maxNumber) {
                    maxNumber = num;
                }
            }
        }
    }
    
    if (maxNumber > 0) {
        nextNumber = maxNumber + 1;
    }

    // If we have company code and prefix, use the format
    let code;
    if (companyCode && fallbackPrefix) {
        const paddedNumber = String(nextNumber).padStart(4, '0');
        code = `${companyCode.toUpperCase()}-${fallbackPrefix}-${paddedNumber}`;
    } else if (fallbackPrefix) {
        const paddedNumber = String(nextNumber).padStart(4, '0');
        code = `${fallbackPrefix}-${paddedNumber}`;
    } else {
        code = nextNumber.toString();
    }

    // Final check: verify the generated code doesn't already exist for this company
    const existingCode = await Model.findOne({
        where: {
            companyId: companyId,
            [codeField]: code
        },
        transaction
    });

    if (existingCode) {
        // Code exists, increment and regenerate
        nextNumber++;
        if (companyCode && fallbackPrefix) {
            const paddedNumber = String(nextNumber).padStart(4, '0');
            code = `${companyCode.toUpperCase()}-${fallbackPrefix}-${paddedNumber}`;
        } else if (fallbackPrefix) {
            const paddedNumber = String(nextNumber).padStart(4, '0');
            code = `${fallbackPrefix}-${paddedNumber}`;
        } else {
            code = nextNumber.toString();
        }
    }

    return code;
}

/**
 * Get Sequelize model for a module name
 */
function getModelForModule(moduleName) {
    const models = require('../models');
    
    const modelMap = {
        'products': models.Product,
        'customers': models.Customer,
        'accounts': models.Account,
        'account_types': models.AccountType,
        'product_categories': models.ProductCategory,
        'product_brand_names': models.ProductBrandName,
        'product_manufacturers': models.ProductManufacturer,
        'product_models': models.ProductModel,
        'product_colors': models.ProductColor,
        'packaging': models.Packaging,
        'tax_codes': models.TaxCode,
        'stores': models.Store,
        'currencies': models.Currency,
        'adjustment_reasons': models.AdjustmentReason,
        'return_reasons': models.ReturnReason,
        'price_categories': models.PriceCategory,
        'payment_methods': models.PaymentMethod,
        'payment_types': models.PaymentType,
        'bank_details': models.BankDetail,
        'product_store_locations': models.ProductStoreLocation,
        'customer_groups': models.CustomerGroup,
        'loyalty_card_configs': models.LoyaltyCardConfig
    };

    return modelMap[moduleName] || null;
}

/**
 * Get code field name for a module
 */
function getCodeFieldForModule(moduleName) {
    const fieldMap = {
        'products': 'code',
        'customers': 'customer_id',
        'accounts': 'code',
        'account_types': 'code',
        'product_categories': 'code',
        'product_brand_names': 'code',
        'product_manufacturers': 'code',
        'product_models': 'code',
        'product_colors': 'code',
        'packaging': 'code',
        'tax_codes': 'code',
        'stores': 'code',
        'currencies': 'code',
        'adjustment_reasons': 'code',
        'return_reasons': 'code',
        'price_categories': 'code',
        'payment_methods': 'code',
        'payment_types': 'code',
        'bank_details': 'code',
        'product_store_locations': 'location_code',
        'customer_groups': 'group_code',
        'loyalty_card_configs': 'loyalty_card_code'
    };

    return fieldMap[moduleName] || 'code';
}

/**
 * Get next code without incrementing (preview only)
 */
async function previewNextCode(moduleName, companyId) {
    const autoCode = await AutoCode.findOne({
        where: {
            module_name: moduleName,
            companyId: companyId,
            status: 'active'
        }
    });

    if (autoCode) {
        return generateCodeFromConfig(autoCode);
    }

    // Fallback preview
    return null;
}

module.exports = {
    generateNextCode,
    previewNextCode,
    generateCodeFromConfig
};

