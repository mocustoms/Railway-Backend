/**
 * Account Type Service
 * Reusable service functions for creating and managing account types
 * Used by both API routes and initialization service
 */

const autoCodeService = require('../utils/autoCodeService');
const { AccountType, Company } = require('../models');

class AccountTypeService {
  /**
   * Create an account type with validation and auto-generated code
   * @param {Object} data - Account type data
   * @param {string} data.name - Account type name
   * @param {string} data.category - Category (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE)
   * @param {string} data.nature - Nature (DEBIT, CREDIT)
   * @param {string} data.description - Optional description
   * @param {boolean} data.is_active - Active status (default: true)
   * @param {string} companyId - Company ID
   * @param {string} userId - User ID (for created_by/updated_by)
   * @param {Object} transaction - Sequelize transaction (optional)
   * @param {string} code - Optional code (if not provided, will be auto-generated)
   * @param {boolean} allowExisting - If true, return existing account type instead of throwing error (for initialization)
   * @returns {Promise<AccountType>} Created account type
   */
  static async createAccountType(data, companyId, userId, transaction = null, code = null, allowExisting = false) {
    const { name, description, category, nature, is_active } = data;

    // Validate required fields
    if (!name || !category || !nature) {
      throw new Error('Missing required fields: name, category, and nature are required');
    }

    // Validate category
    if (!['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(category)) {
      throw new Error('category must be one of: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE');
    }

    // Validate nature
    if (!['DEBIT', 'CREDIT'].includes(nature)) {
      throw new Error('nature must be one of: DEBIT, CREDIT');
    }

    // Check if account type with same name already exists (scoped to company)
    const existingTypeByName = await AccountType.findOne({ 
      where: { name, companyId },
      transaction
    });
    if (existingTypeByName) {
      if (allowExisting) {
      // During initialization, return existing record instead of throwing error
      // This allows the initialization service to map it correctly
      return existingTypeByName;
      } else {
        // For API routes, throw an error
        const error = new Error('An account type with this name already exists');
        error.name = 'SequelizeUniqueConstraintError';
        throw error;
      }
    }
    
    // Also check by code if provided (scoped to company)
    if (code) {
      const existingTypeByCode = await AccountType.findOne({
        where: { code: code.toUpperCase(), companyId },
        transaction
      });
      if (existingTypeByCode) {
        if (allowExisting) {
        return existingTypeByCode;
        } else {
          const error = new Error('An account type with this code already exists');
          error.name = 'SequelizeUniqueConstraintError';
          throw error;
        }
      }
    }

    // Get company code for code generation
    let companyCode = 'EMZ';
    if (!code) {
      try {
        const company = await Company.findByPk(companyId, {
          attributes: ['code', 'name'],
          transaction
        });
        
        if (company?.code) {
          companyCode = company.code.toUpperCase();
        } else if (company?.name) {
          companyCode = company.name.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMZ';
        }
      } catch (companyError) {
        // Continue with default companyCode
      }

      // Auto-generate account type code
      code = await autoCodeService.generateNextCode(
        'account_types',
        companyId,
        {
          transaction,
          fallbackPrefix: 'AT',
          fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
          companyCode: companyCode
        }
      );
    }

    // Create account type
    const { v4: uuidv4 } = require('uuid');
    const accountType = await AccountType.create({
      id: uuidv4(), // Ensure ID is generated
      name,
      code: code.toUpperCase(),
      description: description || null,
      category,
      nature,
      is_active: is_active !== undefined ? is_active : true,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });

    return accountType;
  }
}

module.exports = AccountTypeService;

