/**
 * Initialization Data Service
 * Reusable service functions for creating initialization data
 * Used by both API routes and initialization service
 * 
 * This ensures all data creation uses the same validation and business logic
 */

const autoCodeService = require('../utils/autoCodeService');
const { validateServiceCompanyId, removeCompanyIdFromData } = require('../utils/companyIdValidator');
const { 
  Store, Account, Currency, PriceCategory, CustomerGroup, 
  ProductCategory, Packaging, TaxCode, AdjustmentReason, 
  ReturnReason, PaymentMethod, PaymentType, LinkedAccount,
  AccountType, Company
} = require('../models');

class InitializationDataService {
  /**
   * Get company code for code generation
   */
  static async getCompanyCode(companyId, transaction = null) {
    let companyCode = 'EMZ';
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
    return companyCode;
  }

  /**
   * Create a store
   */
  static async createStore(data, companyId, userId, transaction = null, code = null) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createStore');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { name, store_type, location, phone, email, address, description, 
            is_manufacturing, can_receive_po, can_issue_to_store, can_receive_from_store,
            is_storage_facility, has_temperature_control, latitude, longitude,
            temperature_min, temperature_max, settings, default_currency_id, default_price_category_id } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Store name is required');
    }
    if (!store_type) {
      throw new Error('Store type is required');
    }
    if (!location || !location.trim()) {
      throw new Error('Location is required');
    }
    if (!phone || !phone.trim()) {
      throw new Error('Phone is required');
    }

    const storeEmail = email && email.trim() !== '' ? email.trim() : null;
    if (storeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(storeEmail)) {
      throw new Error('Invalid email format');
    }

    return await Store.create({
      name: name.trim(),
      store_type,
      location: location.trim(),
      phone: phone.trim(),
      email: storeEmail,
      address: address ? address.trim() : null,
      description: description ? description.trim() : null,
      is_active: true,
      is_manufacturing: is_manufacturing || false,
      can_receive_po: can_receive_po || false,
      can_issue_to_store: can_issue_to_store || false,
      can_receive_from_store: can_receive_from_store || false,
      is_storage_facility: is_storage_facility || false,
      has_temperature_control: has_temperature_control || false,
      latitude: latitude || null,
      longitude: longitude || null,
      temperature_min: temperature_min || null,
      temperature_max: temperature_max || null,
      settings: settings || {},
      default_currency_id: default_currency_id || null,
      default_price_category_id: default_price_category_id || null,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create an account
   */
  static async createAccount(data, companyId, userId, transaction = null, code = null, idMappings = {}) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createAccount');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { name, parentId, type, accountTypeId, account_type_id, nature, description, status } = cleanedData;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new Error('Account name is required');
    }

    const finalAccountTypeId = accountTypeId || account_type_id;
    if (!finalAccountTypeId) {
      throw new Error('Account type is required');
    }

    // Map account type ID if needed
    // The finalAccountTypeId is the original UUID from seed data
    // We need to map it to the actual account type ID in the database
    let mappedAccountTypeId = finalAccountTypeId;
    if (idMappings.account_types && idMappings.account_types.has(finalAccountTypeId)) {
      mappedAccountTypeId = idMappings.account_types.get(finalAccountTypeId);
    } else {
      // Try to find account type by code if available (in case the ID is actually a code)
      if (idMappings.account_typesByCode && idMappings.account_typesByCode.has(finalAccountTypeId)) {
        mappedAccountTypeId = idMappings.account_typesByCode.get(finalAccountTypeId);
      } else {
        // Try to find account type by original ID in case mapping wasn't populated
        // This can happen if account_types failed to create or were skipped
        console.warn(`⚠️  Account type ${finalAccountTypeId} not found in mappings for account "${name}". Attempting direct database lookup...`);
        
        // Try direct database lookup by the original UUID (in case it's the actual ID)
        // This handles cases where account types were created in a previous transaction
        const directLookup = await AccountType.findOne({
          where: { id: finalAccountTypeId, companyId },
          transaction
        });
        if (directLookup) {
          mappedAccountTypeId = directLookup.id;
          // Add to mappings for future lookups
          if (idMappings.account_types) {
            idMappings.account_types.set(finalAccountTypeId, directLookup.id);
          }
        } else {
          // If UUID lookup fails, try to find by account type category/name
          // Accounts have a 'type' field (ASSET, LIABILITY, etc.) which matches account type category
          // We can use this to find the right account type
          if (type) {
            // Map account type names to categories
            const categoryToNameMap = {
              'ASSET': 'ASSET',
              'LIABILITY': 'LIABILITIES',
              'LIABILITIES': 'LIABILITIES',
              'EQUITY': 'EQUITY',
              'REVENUE': 'REVENUE',
              'EXPENSE': 'EXPENSES',
              'EXPENSES': 'EXPENSES'
            };
            
            const accountTypeName = categoryToNameMap[type.toUpperCase()] || type.toUpperCase();
            
            // Try to find by name in mappings
            if (idMappings.account_typesByName && idMappings.account_typesByName.has(accountTypeName)) {
              mappedAccountTypeId = idMappings.account_typesByName.get(accountTypeName);
              // Add to mappings
              if (idMappings.account_types) {
                idMappings.account_types.set(finalAccountTypeId, mappedAccountTypeId);
              }
            } else {
              // Try direct database lookup by name
              const accountTypeByName = await AccountType.findOne({
                where: { 
                  name: accountTypeName,
                  companyId 
                },
                transaction
              });
              if (accountTypeByName) {
                mappedAccountTypeId = accountTypeByName.id;
                // Add to mappings
                if (idMappings.account_types) {
                  idMappings.account_types.set(finalAccountTypeId, accountTypeByName.id);
                }
                if (idMappings.account_typesByName) {
                  idMappings.account_typesByName.set(accountTypeName, accountTypeByName.id);
                }
              } else {
                // Try by category instead
                const accountTypeByCategory = await AccountType.findOne({
                  where: { 
                    category: type.toUpperCase(),
                    companyId 
                  },
                  transaction
                });
                if (accountTypeByCategory) {
                  mappedAccountTypeId = accountTypeByCategory.id;
                  // Add to mappings
                  if (idMappings.account_types) {
                    idMappings.account_types.set(finalAccountTypeId, accountTypeByCategory.id);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Get account type to determine nature
    let accountType = await AccountType.findOne({
      where: { id: mappedAccountTypeId, companyId },
      transaction
    });
    if (!accountType) {
      // Try to find by code if the mappedAccountTypeId might be a code
      if (idMappings.account_typesByCode && idMappings.account_typesByCode.has(mappedAccountTypeId)) {
        const accountTypeIdByCode = idMappings.account_typesByCode.get(mappedAccountTypeId);
        accountType = await AccountType.findOne({
          where: { id: accountTypeIdByCode, companyId },
          transaction
        });
        if (accountType) {
          mappedAccountTypeId = accountType.id;
        }
      }
      
      // If still not found, try direct database lookup by code (in case it's a code, not an ID)
      if (!accountType) {
        accountType = await AccountType.findOne({
          where: { code: mappedAccountTypeId, companyId },
          transaction
        });
        if (accountType) {
          mappedAccountTypeId = accountType.id;
          // Add to mappings for future lookups
          if (idMappings.account_typesByCode) {
            idMappings.account_typesByCode.set(finalAccountTypeId, accountType.id);
          }
          if (idMappings.account_types) {
            idMappings.account_types.set(finalAccountTypeId, accountType.id);
          }
        }
      }
      
      // If still not found, try to find any account type as fallback
      if (!accountType) {
        const fallbackAccountType = await AccountType.findOne({
          where: { companyId },
          transaction,
          order: [['created_at', 'ASC']] // Get the first created account type
        });
        if (fallbackAccountType) {
          mappedAccountTypeId = fallbackAccountType.id;
          accountType = fallbackAccountType;
          // Add to mappings
          if (idMappings.account_types) {
            idMappings.account_types.set(finalAccountTypeId, fallbackAccountType.id);
          }
        } else {
          // Last resort: try without transaction (in case account types were committed in previous transaction)
          const accountTypeWithoutTransaction = await AccountType.findOne({
            where: { companyId },
            order: [['created_at', 'ASC']]
          });
          if (accountTypeWithoutTransaction) {
            console.warn(`⚠️  Found account type "${accountTypeWithoutTransaction.name}" outside transaction for account "${name}"`);
            mappedAccountTypeId = accountTypeWithoutTransaction.id;
            accountType = accountTypeWithoutTransaction;
            // Add to mappings
            if (idMappings.account_types) {
              idMappings.account_types.set(finalAccountTypeId, accountTypeWithoutTransaction.id);
            }
          } else {
            throw new Error(`Invalid account type: ${finalAccountTypeId} (mapped: ${mappedAccountTypeId}). No account types found in company. Account types must be created before accounts.`);
          }
        }
      }
    }

    let finalNature = nature || accountType.nature;

    // Map parent ID if needed
    let mappedParentId = parentId;
    if (parentId && idMappings.accounts && idMappings.accounts.has(parentId)) {
      mappedParentId = idMappings.accounts.get(parentId);
    }

    if (mappedParentId) {
      const parentAccount = await Account.findOne({ 
        where: { id: mappedParentId, companyId },
        transaction
      });
      if (parentAccount) {
        finalNature = parentAccount.nature;
      }
    }

    // Generate code if not provided
    if (!code) {
      const companyCode = await this.getCompanyCode(companyId, transaction);
      code = await autoCodeService.generateNextCode(
        'accounts',
        companyId,
        {
          transaction,
          fallbackPrefix: 'ACC',
          fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
          companyCode: companyCode
        }
      );
    }

    return await Account.create({
      name: name.trim(),
      code: code.trim(),
      type: type || accountType.category,
      account_type_id: mappedAccountTypeId,
      parentId: mappedParentId || null,
      nature: finalNature,
      description: description || null,
      status: status || 'active',
      createdBy: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a currency
   */
  static async createCurrency(data, companyId, userId, transaction = null, code = null) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createCurrency');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { name, symbol, country, flag, is_default = false, is_active = true } = cleanedData;

    const trimmedName = (name || '').trim();
    const trimmedSymbol = (symbol || '').trim();
    
    if (!trimmedName) {
      throw new Error('Currency name is required');
    }
    if (!trimmedSymbol) {
      throw new Error('Currency symbol is required');
    }

    // Generate code if not provided
    if (!code) {
      const companyCode = await this.getCompanyCode(companyId, transaction);
      code = await autoCodeService.generateNextCode(
        'currencies',
        companyId,
        {
          transaction,
          fallbackPrefix: 'CUR',
          fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
          companyCode: companyCode
        }
      );
    }

    return await Currency.create({
      name: trimmedName,
      code: code.trim(),
      symbol: trimmedSymbol,
      country: country || null,
      flag: flag || null,
      is_default: is_default,
      is_active: is_active,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a price category
   */
  static async createPriceCategory(data, companyId, userId, transaction = null, code = null) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createPriceCategory');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { 
      name, description, price_change_type, percentage_change,
      scheduled_type, recurring_period, scheduled_date,
      recurring_day_of_week, recurring_date, recurring_month,
      start_time, end_time, is_active = true
    } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Price category name is required');
    }

    // Validate scheduled fields
    if (scheduled_type === 'recurring' && !recurring_period) {
      throw new Error('Recurring period is required for recurring scheduled type');
    }
    if (scheduled_type === 'one_time' && !scheduled_date) {
      throw new Error('Scheduled date is required for one-time scheduled type');
    }
    if (scheduled_type === 'recurring') {
      if (recurring_period === 'weekly' && !recurring_day_of_week) {
        throw new Error('Day of week is required for weekly recurring schedule');
      }
      if ((recurring_period === 'monthly' || recurring_period === 'yearly') && !recurring_date) {
        throw new Error('Date is required for monthly/yearly recurring schedule');
      }
      if (recurring_period === 'yearly' && !recurring_month) {
        throw new Error('Month is required for yearly recurring schedule');
      }
      if (!start_time || !end_time) {
        throw new Error('Start time and end time are required for recurring schedule');
      }
    }

    // Generate code if not provided
    if (!code) {
      const companyCode = await this.getCompanyCode(companyId, transaction);
      code = await autoCodeService.generateNextCode(
        'price_categories',
        companyId,
        {
          transaction,
          fallbackPrefix: 'PRC',
          fallbackFormat: '{COMPANY_CODE}-{PREFIX}-{NUMBER}',
          companyCode: companyCode
        }
      );
    }

    return await PriceCategory.create({
      name: name.trim(),
      code: code.trim(),
      description: description || null,
      price_change_type: price_change_type || 'increase',
      percentage_change: percentage_change ? parseFloat(percentage_change) : 0,
      scheduled_type: scheduled_type || 'not_scheduled',
      recurring_period: recurring_period || null,
      scheduled_date: scheduled_date || null,
      recurring_day_of_week: recurring_day_of_week || null,
      recurring_date: recurring_date ? parseInt(recurring_date) : null,
      recurring_month: recurring_month || null,
      start_time: start_time || null,
      end_time: end_time || null,
      is_active: is_active,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a customer group
   */
  static async createCustomerGroup(data, companyId, userId, transaction = null, idMappings = {}) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createCustomerGroup');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { group_name, group_code, is_default = false, description, is_active = true,
            account_receivable_id, default_liability_account_id } = cleanedData;

    if (!group_name || !group_name.trim()) {
      throw new Error('Group name is required');
    }

    // Map account IDs
    let mappedAccountReceivableId = account_receivable_id;
    if (account_receivable_id && idMappings.accounts && idMappings.accounts.has(account_receivable_id)) {
      mappedAccountReceivableId = idMappings.accounts.get(account_receivable_id);
    }

    let mappedDefaultLiabilityAccountId = default_liability_account_id;
    if (default_liability_account_id && idMappings.accounts && idMappings.accounts.has(default_liability_account_id)) {
      mappedDefaultLiabilityAccountId = idMappings.accounts.get(default_liability_account_id);
    }

    return await CustomerGroup.create({
      group_name: group_name.trim(),
      group_code: group_code || null,
      is_default: is_default,
      description: description || null,
      is_active: is_active,
      account_receivable_id: mappedAccountReceivableId || null,
      default_liability_account_id: mappedDefaultLiabilityAccountId || null,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a product category
   */
  static async createProductCategory(data, companyId, userId, transaction = null, idMappings = {}) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createProductCategory');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { code, name, tax_code_id, purchases_tax_id, cogs_account_id,
            income_account_id, asset_account_id, is_active = true, color, description } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Product category name is required');
    }

    // Map foreign keys
    let mappedTaxCodeId = tax_code_id;
    if (tax_code_id && idMappings.tax_codes && idMappings.tax_codes.has(tax_code_id)) {
      mappedTaxCodeId = idMappings.tax_codes.get(tax_code_id);
    }

    let mappedPurchasesTaxId = purchases_tax_id;
    if (purchases_tax_id && idMappings.tax_codes && idMappings.tax_codes.has(purchases_tax_id)) {
      mappedPurchasesTaxId = idMappings.tax_codes.get(purchases_tax_id);
    }

    let mappedCogsAccountId = cogs_account_id;
    if (cogs_account_id && idMappings.accounts && idMappings.accounts.has(cogs_account_id)) {
      mappedCogsAccountId = idMappings.accounts.get(cogs_account_id);
    }

    let mappedIncomeAccountId = income_account_id;
    if (income_account_id && idMappings.accounts && idMappings.accounts.has(income_account_id)) {
      mappedIncomeAccountId = idMappings.accounts.get(income_account_id);
    }

    let mappedAssetAccountId = asset_account_id;
    if (asset_account_id && idMappings.accounts && idMappings.accounts.has(asset_account_id)) {
      mappedAssetAccountId = idMappings.accounts.get(asset_account_id);
    }

    return await ProductCategory.create({
      code: code || null,
      name: name.trim(),
      tax_code_id: mappedTaxCodeId || null,
      purchases_tax_id: mappedPurchasesTaxId || null,
      cogs_account_id: mappedCogsAccountId || null,
      income_account_id: mappedIncomeAccountId || null,
      asset_account_id: mappedAssetAccountId || null,
      is_active: is_active,
      color: color || null,
      description: description || null,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create packaging
   */
  static async createPackaging(data, companyId, userId, transaction = null) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createPackaging');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { code, name, pieces, status = 'active', unit } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Packaging name is required');
    }
    if (pieces === undefined || pieces === null) {
      throw new Error('Pieces is required');
    }

    return await Packaging.create({
      code: code || null,
      name: name.trim(),
      pieces: parseInt(pieces),
      status: status,
      unit: unit || null,
      createdBy: userId, // Use camelCase to match model
      updatedBy: userId, // Use camelCase to match model
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a tax code
   */
  static async createTaxCode(data, companyId, userId, transaction = null, idMappings = {}) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createTaxCode');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { code, name, rate, indicator, efd_department_code,
            sales_tax_account_id, purchases_tax_account_id, is_active = true, is_wht = false } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Tax code name is required');
    }
    if (rate === undefined || rate === null) {
      throw new Error('Tax rate is required');
    }

    // Map account IDs
    let mappedSalesTaxAccountId = sales_tax_account_id;
    if (sales_tax_account_id && idMappings.accounts && idMappings.accounts.has(sales_tax_account_id)) {
      mappedSalesTaxAccountId = idMappings.accounts.get(sales_tax_account_id);
    }

    let mappedPurchasesTaxAccountId = purchases_tax_account_id;
    if (purchases_tax_account_id && idMappings.accounts && idMappings.accounts.has(purchases_tax_account_id)) {
      mappedPurchasesTaxAccountId = idMappings.accounts.get(purchases_tax_account_id);
    }

    return await TaxCode.create({
      code: code || null,
      name: name.trim(),
      rate: parseFloat(rate),
      indicator: indicator || null,
      efd_department_code: efd_department_code || null,
      sales_tax_account_id: mappedSalesTaxAccountId || null,
      purchases_tax_account_id: mappedPurchasesTaxAccountId || null,
      is_active: is_active,
      is_wht: is_wht,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create an adjustment reason
   */
  static async createAdjustmentReason(data, companyId, userId, transaction = null, idMappings = {}) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createAdjustmentReason');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { code, name, description, adjustment_type, tracking_account_id,
            is_active = true, corresponding_account_id } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Adjustment reason name is required');
    }
    if (!tracking_account_id) {
      throw new Error('Tracking account is required');
    }

    // Map account IDs
    let mappedTrackingAccountId = tracking_account_id;
    if (idMappings.accounts && idMappings.accounts.has(tracking_account_id)) {
      mappedTrackingAccountId = idMappings.accounts.get(tracking_account_id);
    } else {
      // Try to find in database (handles cases where accounts already exist)
      const { Op } = require('sequelize');
      const existingAccount = await Account.findOne({
        where: { 
          [Op.or]: [
            { id: tracking_account_id, companyId },
            { code: tracking_account_id, companyId }
          ]
        },
        transaction
      });
      
      if (existingAccount) {
        mappedTrackingAccountId = existingAccount.id;
        // Add to mappings for future lookups
        if (existingAccount.code) {
          idMappings.accountsByCode = idMappings.accountsByCode || new Map();
          idMappings.accountsByCode.set(existingAccount.code, existingAccount.id);
        }
        if (tracking_account_id !== existingAccount.id) {
          idMappings.accounts.set(tracking_account_id, existingAccount.id);
        }
      } else {
        // Try to get first available account as fallback
        const firstAccount = idMappings.accounts ? Array.from(idMappings.accounts.values())[0] : null;
        if (firstAccount) {
          mappedTrackingAccountId = firstAccount;
        } else {
          throw new Error(`Tracking account ${tracking_account_id} not found in account mappings or database`);
        }
      }
    }

    let mappedCorrespondingAccountId = corresponding_account_id;
    if (corresponding_account_id && idMappings.accounts && idMappings.accounts.has(corresponding_account_id)) {
      mappedCorrespondingAccountId = idMappings.accounts.get(corresponding_account_id);
    }

    return await AdjustmentReason.create({
      code: code || null,
      name: name.trim(),
      description: description || null,
      adjustment_type: adjustment_type || 'add',
      tracking_account_id: mappedTrackingAccountId,
      corresponding_account_id: mappedCorrespondingAccountId || null,
      is_active: is_active,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a return reason
   */
  static async createReturnReason(data, companyId, userId, transaction = null, idMappings = {}) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createReturnReason');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { code, name, description, return_type, requires_approval = false,
            max_return_days, refund_account_id, inventory_account_id, is_active = true } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Return reason name is required');
    }
    if (!refund_account_id) {
      throw new Error('Refund account is required');
    }

    // Map account IDs
    let mappedRefundAccountId = refund_account_id;
    if (idMappings.accounts && idMappings.accounts.has(refund_account_id)) {
      mappedRefundAccountId = idMappings.accounts.get(refund_account_id);
    } else {
      // Try to find in database (handles cases where accounts already exist)
      const { Op } = require('sequelize');
      const existingAccount = await Account.findOne({
        where: { 
          [Op.or]: [
            { id: refund_account_id, companyId },
            { code: refund_account_id, companyId }
          ]
        },
        transaction
      });
      
      if (existingAccount) {
        mappedRefundAccountId = existingAccount.id;
        // Add to mappings for future lookups
        if (existingAccount.code) {
          idMappings.accountsByCode = idMappings.accountsByCode || new Map();
          idMappings.accountsByCode.set(existingAccount.code, existingAccount.id);
        }
        if (refund_account_id !== existingAccount.id) {
          idMappings.accounts.set(refund_account_id, existingAccount.id);
        }
      } else {
        // Try to get first available account as fallback
        const firstAccount = idMappings.accounts ? Array.from(idMappings.accounts.values())[0] : null;
        if (firstAccount) {
          mappedRefundAccountId = firstAccount;
        } else {
          throw new Error(`Refund account ${refund_account_id} not found in account mappings or database`);
        }
      }
    }

    let mappedInventoryAccountId = inventory_account_id;
    if (inventory_account_id && idMappings.accounts && idMappings.accounts.has(inventory_account_id)) {
      mappedInventoryAccountId = idMappings.accounts.get(inventory_account_id);
    }

    return await ReturnReason.create({
      code: code || null,
      name: name.trim(),
      description: description || null,
      return_type: return_type || 'full_refund',
      requires_approval: requires_approval,
      max_return_days: max_return_days || null,
      refund_account_id: mappedRefundAccountId,
      inventory_account_id: mappedInventoryAccountId || null,
      is_active: is_active,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a payment method
   */
  static async createPaymentMethod(data, companyId, userId, transaction = null, existingCode = null) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createPaymentMethod');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { code, name, deducts_from_customer_account = true,
            requires_bank_details = false, upload_document = false, is_active = true } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Payment method name is required');
    }

    // Use existing code if provided, otherwise auto-generate
    let finalCode = existingCode || code;
    if (!finalCode) {
      const autoCodeService = require('../utils/autoCodeService');
      finalCode = await autoCodeService.generateNextCode(
        'payment_methods',
        companyId,
        {
          transaction,
          fallbackPrefix: 'PMT',
          fallbackFormat: '{PREFIX}-{NUMBER}'
        }
      );
    }

    return await PaymentMethod.create({
      id: require('uuid').v4(), // Ensure ID is generated
      code: finalCode,
      name: name.trim(),
      deducts_from_customer_account: deducts_from_customer_account,
      requires_bank_details: requires_bank_details,
      upload_document: upload_document,
      is_active: is_active,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a payment type
   */
  static async createPaymentType(data, companyId, userId, transaction = null, idMappings = {}) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createPaymentType');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { code, name, payment_method_id, order_of_display = 1,
            default_account_id, used_in_sales = true, used_in_debtor_payments = true,
            used_in_credit_payments = true, used_in_customer_deposits = true,
            used_in_refunds = true, display_in_cashier_report = true,
            used_in_banking = false, is_active = true } = cleanedData;

    if (!name || !name.trim()) {
      throw new Error('Payment type name is required');
    }
    if (!payment_method_id) {
      throw new Error('Payment method is required');
    }

    // Map payment method ID - check by UUID (original ID) or code
    let mappedPaymentMethodId = payment_method_id;
    if (idMappings.payment_methods) {
      // First try to find by UUID (original ID)
      if (idMappings.payment_methods.has(payment_method_id)) {
        mappedPaymentMethodId = idMappings.payment_methods.get(payment_method_id);
      } else {
        // If not found, try to find in database (handles cases where payment methods already exist)
        const { Op } = require('sequelize');
        const existingPaymentMethod = await PaymentMethod.findOne({
          where: { 
            [Op.or]: [
              { id: payment_method_id, companyId },
              { code: payment_method_id, companyId }
            ]
          },
          transaction
        });
        
        if (existingPaymentMethod) {
          mappedPaymentMethodId = existingPaymentMethod.id;
          // Add to mappings for future lookups
          if (existingPaymentMethod.code) {
            idMappings.payment_methods.set(existingPaymentMethod.code, existingPaymentMethod.id);
          }
          if (payment_method_id !== existingPaymentMethod.id) {
            idMappings.payment_methods.set(payment_method_id, existingPaymentMethod.id);
          }
        } else {
          // Last resort: try to find any payment method in the company
          // This handles cases where the original UUID doesn't match but payment methods exist
          const fallbackPaymentMethod = await PaymentMethod.findOne({
            where: { companyId },
            transaction,
            order: [['created_at', 'ASC']] // Get the first one
          });
          
          if (fallbackPaymentMethod) {
            console.warn(`⚠️  Payment method ${payment_method_id} not found, using first available payment method "${fallbackPaymentMethod.name}" (${fallbackPaymentMethod.code}) as fallback`);
            mappedPaymentMethodId = fallbackPaymentMethod.id;
            // Add to mappings
            if (fallbackPaymentMethod.code) {
              idMappings.payment_methods.set(fallbackPaymentMethod.code, fallbackPaymentMethod.id);
            }
            idMappings.payment_methods.set(payment_method_id, fallbackPaymentMethod.id);
          } else {
            throw new Error(`Payment method ${payment_method_id} not found in payment method mappings or database`);
          }
        }
      }
    } else {
      throw new Error('Payment method mappings not available');
    }

    // Map account ID
    let mappedDefaultAccountId = default_account_id;
    if (default_account_id && idMappings.accounts && idMappings.accounts.has(default_account_id)) {
      mappedDefaultAccountId = idMappings.accounts.get(default_account_id);
    }

    return await PaymentType.create({
      code: code || null,
      name: name.trim(),
      payment_method_id: mappedPaymentMethodId,
      order_of_display: order_of_display,
      default_account_id: mappedDefaultAccountId || null,
      used_in_sales: used_in_sales,
      used_in_debtor_payments: used_in_debtor_payments,
      used_in_credit_payments: used_in_credit_payments,
      used_in_customer_deposits: used_in_customer_deposits,
      used_in_refunds: used_in_refunds,
      display_in_cashier_report: display_in_cashier_report,
      used_in_banking: used_in_banking,
      is_active: is_active,
      created_by: userId,
      updated_by: userId,
      companyId: companyId
    }, { transaction });
  }

  /**
   * Create a linked account
   */
  static async createLinkedAccount(data, companyId, userId, transaction = null, idMappings = {}) {
    // Validate companyId (security: ensure it's from system, not user input)
    validateServiceCompanyId(companyId, 'InitializationDataService.createLinkedAccount');
    
    // Remove companyId from data if present (security: prevent override)
    const cleanedData = removeCompanyIdFromData(data);
    const { account_type, account_id } = cleanedData;

    if (!account_type) {
      throw new Error('Account type is required');
    }

    // Map account ID
    let mappedAccountId = account_id;
    if (account_id && idMappings.accounts && idMappings.accounts.has(account_id)) {
      mappedAccountId = idMappings.accounts.get(account_id);
    }

    return await LinkedAccount.create({
      account_type: account_type,
      account_id: mappedAccountId || null,
      created_by: userId,
      companyId: companyId
    }, { transaction });
  }
}

module.exports = InitializationDataService;

