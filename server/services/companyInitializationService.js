/**
 * Company Initialization Service
 * Initializes default data for new companies from the initial-company-data.json file
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { QueryTypes } = require('sequelize');
const AccountTypeService = require('./accountTypeService');
const ExchangeRateService = require('./exchangeRateService');
const InitializationDataService = require('./initializationDataService');

const INITIAL_DATA_FILE = path.join(__dirname, '../../data/initial-company-data.json');

// Table initialization order (dependencies first)
const INITIALIZATION_ORDER = [
  // Core foundation data (must be first to avoid foreign key constraints)
  'financial_years',      // 1. Financial year - no dependencies
  'currencies',           // 2. Currency - no dependencies
  'account_types',        // 3. Account type - no dependencies (accounts depend on this)
  'accounts',             // 4. Account - depends on account_types
  'price_categories',     // 5. Price Category - no dependencies
  'exchange_rates',       // 6. Exchange Rate - depends on currencies
  'payment_methods',     // 7. Payment Methods - no dependencies (must be before payment_types)
  
  // Secondary data (depends on foundation data above)
  'stores',               // Depends on currencies and price_categories
  'customer_groups',      // Depends on accounts
  'linked_accounts',      // Depends on accounts
  'product_categories',   // Depends on tax_codes and accounts
  'packaging',            // No dependencies
  'tax_codes',            // No dependencies
  'adjustment_reasons',   // Depends on accounts (tracking_account_id)
  'return_reasons',       // Depends on accounts (refund_account_id)
  'payment_types',        // Depends on payment_methods
];

class CompanyInitializationService {
  constructor(sequelize, models) {
    this.sequelize = sequelize;
    this.models = models;
    this.initialData = null;
  }

  /**
   * Get model name from table name
   */
  getModelName(tableName) {
    const modelMap = {
      'stores': 'Store',
      'accounts': 'Account',
      'financial_years': 'FinancialYear',
      'customer_groups': 'CustomerGroup',
      'linked_accounts': 'LinkedAccount',
      'product_categories': 'ProductCategory',
      'packaging': 'Packaging',
      'tax_codes': 'TaxCode',
      'adjustment_reasons': 'AdjustmentReason',
      'return_reasons': 'ReturnReason',
      'price_categories': 'PriceCategory',
      'currencies': 'Currency',
      'account_types': 'AccountType',
      'exchange_rates': 'ExchangeRate',
      'payment_methods': 'PaymentMethod',
      'payment_types': 'PaymentType',
    };
    return modelMap[tableName];
  }

  /**
   * Load initial data from JSON file
   */
  loadInitialData() {
    try {
      if (!fs.existsSync(INITIAL_DATA_FILE)) {
        throw new Error(`Initial data file not found: ${INITIAL_DATA_FILE}`);
      }
      
      const fileContent = fs.readFileSync(INITIAL_DATA_FILE, 'utf8');
      this.initialData = JSON.parse(fileContent);
      return this.initialData;
    } catch (error) {
      throw new Error(`Failed to load initial data: ${error.message}`);
    }
  }

  /**
   * Initialize company data
   * @param {string} companyId - The new company ID
   * @param {string} userId - The user ID creating the company (will be used as creator)
   * @param {Function} progressCallback - Optional callback for progress updates
   */
  async initializeCompany(companyId, userId, progressCallback = null, selectedTables = null) {
    // Always reload initial data to ensure we have the latest data
    this.loadInitialData();

    // Filter initialization order if specific tables are requested
    let tablesToInitialize = INITIALIZATION_ORDER;
    if (selectedTables && Array.isArray(selectedTables) && selectedTables.length > 0) {
      // Only initialize tables that are in both INITIALIZATION_ORDER and selectedTables
      tablesToInitialize = INITIALIZATION_ORDER.filter(table => selectedTables.includes(table));
      
      // Validate that all selected tables exist
      const invalidTables = selectedTables.filter(table => !INITIALIZATION_ORDER.includes(table));
      if (invalidTables.length > 0) {
        throw new Error(`Invalid table names: ${invalidTables.join(', ')}`);
      }
    }

    // Use individual transactions per table to avoid full rollback on errors
    const results = {
      total: 0,
      successful: 0,
      failed: 0,
      errors: [],
      details: {}
    };

    // Track ID mappings for foreign key resolution
    const idMappings = {
      accounts: new Map(), // old account ID -> new account id
      accountsByCode: new Map(), // account code -> new account id
      currencies: new Map(), // old currency ID -> new currency id
      currenciesByCode: new Map(), // currency code -> new currency id
      account_types: new Map(), // old account type ID -> new account type id
      account_typesByCode: new Map(), // account type code -> new account type id
      account_typesByName: new Map(), // account type name -> new account type id (more reliable than codes)
      price_categories: new Map(), // old price category ID -> new price category id
      price_categoriesByCode: new Map(), // price category code -> new price category id
      stores: new Map(), // old store ID -> new store id
      tax_codes: new Map(), // tax code -> new tax code id
      tax_codesById: new Map(), // old tax code ID -> new tax code id
      payment_methods: new Map(), // payment method code -> new payment method id
      exchange_rates: new Map(), // old exchange rate ID -> new exchange rate id
    };

    try {
      // Get the user to use as creator (no transaction needed for this simple lookup)
      const creatorUser = await this.models.User.findByPk(userId);
      if (!creatorUser) {
        throw new Error('Creator user not found');
      }

      // Initialize tables in order - use individual transactions per table
      for (const tableName of tablesToInitialize) {
        // Special handling for financial_years - generate dynamically based on current year
        let records;
        if (tableName === 'financial_years') {
          // Generate financial year for the current registration year
          const currentYear = new Date().getFullYear();
          const startDate = `${currentYear}-01-01`;
          const endDate = `${currentYear}-12-31`;
          
          records = [{
            name: currentYear.toString(),
            startDate: startDate,
            endDate: endDate,
            description: `Financial year ${currentYear}`,
            isCurrent: true,
            isActive: true,
            isClosed: false,
            closedAt: null,
            closingNotes: null
          }];
        } else {
          // For other tables, use data from JSON file
          if (!this.initialData.tables[tableName] || this.initialData.tables[tableName].length === 0) {
            // Skip tables that don't have data in the JSON file
            // This is OK - not all tables need to be initialized
            // Still initialize results for this table
            results.details[tableName] = { total: 0, created: 0, errors: [], skipped: 0 };
            continue;
          }
          records = this.initialData.tables[tableName];
        }

        results.total += records.length;
        results.details[tableName] = { total: records.length, created: 0, errors: [], skipped: 0 };

        if (progressCallback) {
          progressCallback({
            stage: 'initializing',
            table: tableName,
            message: `Initializing ${tableName}...`,
            progress: 0,
            total: records.length
          });
        }

        // Use a transaction per table to allow partial success
        const tableTransaction = await this.sequelize.transaction();
        let created = 0;
        
        try {
          for (let i = 0; i < records.length; i++) {
            const record = records[i];
            
            // Create savepoint for each record
            const savepointName = `sp_${tableName}_${i}`;
            try {
              await tableTransaction.sequelize.query(`SAVEPOINT ${savepointName}`, { transaction: tableTransaction });
            } catch (spError) {
              // If savepoint creation fails, transaction is already aborted
              console.error(`Failed to create savepoint for ${tableName}[${i}]:`, spError.message);
              // Log error to results before breaking
              const errorMessage = `Transaction aborted: ${spError.message}`;
              results.failed++;
              results.errors.push({
                table: tableName,
                recordIndex: i,
                error: errorMessage
              });
              results.details[tableName].errors.push({
                index: i,
                error: errorMessage
              });
              // Always log critical table errors
              if (tableName === 'accounts' || tableName === 'financial_years') {
                console.error(`\n❌ CRITICAL: Savepoint failed for ${tableName} record ${i + 1}:`, {
                  error: errorMessage,
                  errorName: spError.name,
                  stack: spError.stack?.substring(0, 300)
                });
              }
              break; // Exit loop if transaction is aborted
            }
            
            try {
              let newRecord;
              
              // Use service functions for all tables (same logic as API routes)
              try {
                if (tableName === 'account_types') {
                  // Use AccountTypeService (same as POST /api/administration/account-types)
                  // Pass allowExisting=true to return existing records instead of throwing errors
                  try {
                    newRecord = await AccountTypeService.createAccountType(
                      record,
                      companyId,
                      userId,
                      tableTransaction,
                      record.code, // Use existing code from source data
                      true // allowExisting = true for initialization
                    );
                  } catch (accountTypeError) {
                    console.error(`  ❌ AccountTypeService error for ${record.name}:`, {
                      errorName: accountTypeError?.name,
                      message: accountTypeError?.message,
                      stack: accountTypeError?.stack?.substring(0, 300),
                      record: record
                    });
                    throw accountTypeError;
                  }
                } else if (tableName === 'exchange_rates') {
                  // Use ExchangeRateService (same as POST /api/exchange-rates)
                  // First map currency IDs with database fallback
                  const mappedRecord = { ...record };
                  const { Currency } = require('../models');
                  const { Op } = require('sequelize');
                  
                  if (record.from_currency_id) {
                    if (idMappings.currencies && idMappings.currencies.has(record.from_currency_id)) {
                      mappedRecord.from_currency_id = idMappings.currencies.get(record.from_currency_id);
                    } else {
                      // Try to find in database (handles cases where currencies already exist)
                      const existingCurrency = await Currency.findOne({
                        where: { 
                          [Op.or]: [
                            { id: record.from_currency_id, companyId },
                            { code: record.from_currency_id, companyId }
                          ]
                        },
                        transaction: tableTransaction
                      });
                      if (existingCurrency) {
                        mappedRecord.from_currency_id = existingCurrency.id;
                        // Add to mappings
                        if (existingCurrency.code) {
                          idMappings.currenciesByCode.set(existingCurrency.code, existingCurrency.id);
                        }
                        idMappings.currencies.set(record.from_currency_id, existingCurrency.id);
                      } else {
                        throw new Error(`from_currency_id ${record.from_currency_id} not found in currency mappings or database`);
                      }
                    }
                  }
                  
                  if (record.to_currency_id) {
                    if (idMappings.currencies && idMappings.currencies.has(record.to_currency_id)) {
                      mappedRecord.to_currency_id = idMappings.currencies.get(record.to_currency_id);
                    } else {
                      // Try to find in database
                      const existingCurrency = await Currency.findOne({
                        where: { 
                          [Op.or]: [
                            { id: record.to_currency_id, companyId },
                            { code: record.to_currency_id, companyId }
                          ]
                        },
                        transaction: tableTransaction
                      });
                      if (existingCurrency) {
                        mappedRecord.to_currency_id = existingCurrency.id;
                        // Add to mappings
                        if (existingCurrency.code) {
                          idMappings.currenciesByCode.set(existingCurrency.code, existingCurrency.id);
                        }
                        idMappings.currencies.set(record.to_currency_id, existingCurrency.id);
                      } else {
                        throw new Error(`to_currency_id ${record.to_currency_id} not found in currency mappings or database`);
                      }
                    }
                  }
                  
                  newRecord = await ExchangeRateService.createExchangeRate(
                    mappedRecord,
                    companyId,
                    userId,
                    tableTransaction
                  );
                } else if (tableName === 'financial_years') {
                  // Special handling for financial_years - use Model.create with validate: false
                  const currentYear = new Date().getFullYear();
                  const startDate = `${currentYear}-01-01`;
                  const endDate = `${currentYear}-12-31`;
                  
                  // First check if it already exists
                  const existing = await this.models.FinancialYear.findOne({
                    where: { name: currentYear.toString(), companyId: companyId },
                    transaction: tableTransaction
                  });
                  
                  if (existing) {
                    newRecord = existing;
                  } else {
                    // Use Model.create with validate: false to bypass Sequelize validation
                    // The database composite unique constraint will handle per-company uniqueness
                    newRecord = await this.models.FinancialYear.create({
                      id: uuidv4(),
                      name: currentYear.toString(),
                      startDate: startDate,
                      endDate: endDate,
                      description: `Financial year ${currentYear}`,
                      isCurrent: true,
                      isActive: true,
                      isClosed: false,
                      companyId: companyId,
                      createdBy: userId,
                      updatedBy: userId
                    }, {
                      validate: false, // Skip Sequelize validation - let database handle uniqueness
                      transaction: tableTransaction
                    });
                  }
                } else if (tableName === 'stores') {
                  newRecord = await InitializationDataService.createStore(
                    record,
                    companyId,
                    userId,
                    tableTransaction
                  );
                } else if (tableName === 'accounts') {
                  newRecord = await InitializationDataService.createAccount(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    record.code, // Use existing code from source data
                    idMappings
                  );
                } else if (tableName === 'currencies') {
                  newRecord = await InitializationDataService.createCurrency(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    record.code // Use existing code from source data
                  );
                } else if (tableName === 'price_categories') {
                  newRecord = await InitializationDataService.createPriceCategory(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    record.code // Use existing code from source data
                  );
                } else if (tableName === 'customer_groups') {
                  newRecord = await InitializationDataService.createCustomerGroup(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    idMappings
                  );
                } else if (tableName === 'product_categories') {
                  newRecord = await InitializationDataService.createProductCategory(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    idMappings
                  );
                } else if (tableName === 'packaging') {
                  newRecord = await InitializationDataService.createPackaging(
                    record,
                    companyId,
                    userId,
                    tableTransaction
                  );
                } else if (tableName === 'tax_codes') {
                  newRecord = await InitializationDataService.createTaxCode(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    idMappings
                  );
                } else if (tableName === 'adjustment_reasons') {
                  newRecord = await InitializationDataService.createAdjustmentReason(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    idMappings
                  );
                } else if (tableName === 'return_reasons') {
                  newRecord = await InitializationDataService.createReturnReason(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    idMappings
                  );
                } else if (tableName === 'payment_methods') {
                  newRecord = await InitializationDataService.createPaymentMethod(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    record.code
                  );
                } else if (tableName === 'payment_types') {
                  newRecord = await InitializationDataService.createPaymentType(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    idMappings
                  );
                } else if (tableName === 'linked_accounts') {
                  newRecord = await InitializationDataService.createLinkedAccount(
                    record,
                    companyId,
                    userId,
                    tableTransaction,
                    idMappings
                  );
                } else {
                  // Fallback to generic createRecord for any tables not yet covered
                  newRecord = await this.createRecord(
                    tableName, 
                    record, 
                    companyId, 
                    userId, 
                    tableTransaction,
                    idMappings
                  );
                }
              } catch (serviceError) {
                // Log detailed error for debugging - always log for critical tables
                if (tableName === 'accounts' || tableName === 'financial_years' || tableName === 'account_types' || tableName === 'payment_methods') {
                  console.error(`\n❌ CRITICAL Error in service function for ${tableName} record ${i + 1}:`, {
                    errorName: serviceError?.name || 'Unknown',
                    message: serviceError?.message || String(serviceError),
                    stack: serviceError?.stack?.substring(0, 500),
                    errorType: serviceError?.constructor?.name,
                    fullError: serviceError,
                    record: {
                      name: record?.name,
                      code: record?.code,
                      category: record?.category,
                      nature: record?.nature,
                      _originalId: record?._originalId
                    }
                  });
                  // Also log the raw error
                  console.error(`Raw error object:`, serviceError);
                }
                // Ensure we always have an error object to throw
                if (!serviceError || typeof serviceError !== 'object') {
                  serviceError = new Error(String(serviceError || 'Unknown error in service function'));
                }
                // Re-throw to be caught by outer catch block
                throw serviceError;
              }
              
              // Release savepoint on success
              await tableTransaction.sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction: tableTransaction });
            
      // Track ID mappings for foreign key resolution
      if (tableName === 'accounts') {
        if (record._originalId) {
          idMappings.accounts.set(record._originalId, newRecord.id);
        }
        if (record.code) {
          idMappings.accountsByCode.set(record.code, newRecord.id);
        }
      }
      if (tableName === 'currencies') {
        if (record._originalId) {
          idMappings.currencies.set(record._originalId, newRecord.id);
        }
        if (record.code) {
          idMappings.currenciesByCode.set(record.code, newRecord.id);
        }
      }
      if (tableName === 'account_types') {
        if (record._originalId) {
          idMappings.account_types.set(record._originalId, newRecord.id);
        }
        if (record.code) {
          idMappings.account_typesByCode.set(record.code, newRecord.id);
        }
        if (record.name) {
          // Map by name - more reliable than codes (codes might be auto-generated)
          idMappings.account_typesByName = idMappings.account_typesByName || new Map();
          idMappings.account_typesByName.set(record.name.toUpperCase(), newRecord.id);
        }
      }
      if (tableName === 'exchange_rates') {
        if (record._originalId) {
          idMappings.exchange_rates.set(record._originalId, newRecord.id);
        }
      }
      if (tableName === 'price_categories') {
        if (record._originalId) {
          idMappings.price_categories.set(record._originalId, newRecord.id);
        }
        if (record.code) {
          idMappings.price_categoriesByCode.set(record.code, newRecord.id);
        }
      }
      if (tableName === 'stores' && record._originalId) {
        idMappings.stores.set(record._originalId, newRecord.id);
      }
      // Track tax_codes by code and original ID for product_categories
      if (tableName === 'tax_codes') {
        if (!idMappings.tax_codes) {
          idMappings.tax_codes = new Map();
        }
        if (record.code) {
          idMappings.tax_codes.set(record.code, newRecord.id);
        }
        if (record._originalId) {
          if (!idMappings.tax_codesById) {
            idMappings.tax_codesById = new Map();
          }
          idMappings.tax_codesById.set(record._originalId, newRecord.id);
        }
      }
      // Track payment_methods by code and original ID for payment_types
      if (tableName === 'payment_methods') {
        if (!idMappings.payment_methods) {
          idMappings.payment_methods = new Map();
        }
        if (record.code) {
          idMappings.payment_methods.set(record.code, newRecord.id);
        }
        if (record._originalId) {
          // Also track by original ID for UUID-based references
          idMappings.payment_methods.set(record._originalId, newRecord.id);
        }
      }
            
            created++;
            results.successful++;

            if (progressCallback) {
              progressCallback({
                stage: 'initializing',
                table: tableName,
                message: `Creating ${tableName} record ${i + 1} of ${records.length}...`,
                progress: i + 1,
                total: records.length
              });
            }
            } catch (error) {
              // Ensure we have an error object - CRITICAL for debugging
              if (!error) {
                console.error(`⚠️  CRITICAL: Caught null/undefined error for ${tableName}[${i}]`);
                error = new Error('Unknown error occurred during record creation');
              }
              
              // Always log the raw error for critical tables BEFORE any processing
              if (tableName === 'account_types' || tableName === 'financial_years' || tableName === 'currencies' || tableName === 'payment_methods') {
                console.error(`\n🔴 RAW ERROR caught for ${tableName}[${i + 1}]:`, {
                  error: error,
                  errorType: typeof error,
                  errorName: error?.name,
                  errorMessage: error?.message,
                  errorStack: error?.stack?.substring(0, 500),
                  errorConstructor: error?.constructor?.name,
                  hasErrors: !!error?.errors,
                  errorErrors: error?.errors
                });
              }
              
              // Rollback to savepoint on error - but NEVER abort the entire process
              let rollbackSuccess = false;
              try {
                await tableTransaction.sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction: tableTransaction });
                rollbackSuccess = true;
              } catch (rollbackError) {
                // If rollback fails, transaction might be aborted - try to continue anyway
                console.error(`⚠️  Failed to rollback to savepoint for ${tableName}[${i}]: ${rollbackError?.message || String(rollbackError)}`);
                // Don't break - continue to next record
                // If transaction is truly aborted, the next record will fail and we'll handle it
              }
              
              // Special logging for financial_years to debug
              if (tableName === 'financial_years') {
                console.error(`  ❌ Financial year creation error:`, {
                  errorName: error.name,
                  errorMessage: error.message,
                  hasErrors: !!error.errors,
                  errors: error.errors?.map(e => ({ path: e.path, message: e.message }))
                });
              }
              
              // Handle unique constraint errors - skip if record already exists (this is OK)
              // Note: Database constraints should be company-scoped (composite unique indexes with companyId)
              // This ensures we only skip duplicates within the same company, not across companies
              if (error.name === 'SequelizeUniqueConstraintError') {
                
                // CRITICAL: Find the existing record and add it to mappings
                // This ensures dependent records can find the existing record
                try {
                  const Model = this.models[this.getModelName(tableName)];
                  if (Model) {
                    let existingRecord = null;
                    
                    // Try to find by code first (most reliable)
                    if (record.code) {
                      existingRecord = await Model.findOne({
                        where: { code: record.code, companyId },
                        transaction: tableTransaction
                      });
                    }
                    
                    // If not found by code, try by name (for tables without code)
                    if (!existingRecord && record.name) {
                      existingRecord = await Model.findOne({
                        where: { name: record.name, companyId },
                        transaction: tableTransaction
                      });
                    }
                    
                    if (existingRecord) {
                      // Set newRecord and add to mappings immediately
                      newRecord = existingRecord;
                      
                      // CRITICAL: Add to mappings immediately so dependent records can find it
                      if (tableName === 'accounts') {
                        if (record._originalId) {
                          idMappings.accounts.set(record._originalId, existingRecord.id);
                        }
                        if (record.code) {
                          idMappings.accountsByCode.set(record.code, existingRecord.id);
                        }
                      }
                      if (tableName === 'currencies') {
                        if (record._originalId) {
                          idMappings.currencies.set(record._originalId, existingRecord.id);
                        }
                        if (record.code) {
                          idMappings.currenciesByCode.set(record.code, existingRecord.id);
                        }
                      }
                      if (tableName === 'account_types') {
                        if (record._originalId) {
                          idMappings.account_types.set(record._originalId, existingRecord.id);
                        }
                        if (record.code) {
                          idMappings.account_typesByCode.set(record.code, existingRecord.id);
                        }
                        if (record.name) {
                          idMappings.account_typesByName = idMappings.account_typesByName || new Map();
                          idMappings.account_typesByName.set(record.name.toUpperCase(), existingRecord.id);
                        }
                      }
                      if (tableName === 'payment_methods') {
                        if (!idMappings.payment_methods) {
                          idMappings.payment_methods = new Map();
                        }
                        if (record.code) {
                          idMappings.payment_methods.set(record.code, existingRecord.id);
                        }
                        if (record._originalId) {
                          idMappings.payment_methods.set(record._originalId, existingRecord.id);
                        }
                      }
                      if (tableName === 'stores' && record._originalId) {
                        idMappings.stores.set(record._originalId, existingRecord.id);
                      }
                      if (tableName === 'price_categories') {
                        if (record._originalId) {
                          idMappings.price_categories.set(record._originalId, existingRecord.id);
                        }
                        if (record.code) {
                          idMappings.price_categoriesByCode.set(record.code, existingRecord.id);
                        }
                      }
                      if (tableName === 'tax_codes') {
                        if (!idMappings.tax_codes) {
                          idMappings.tax_codes = new Map();
                        }
                        if (record.code) {
                          idMappings.tax_codes.set(record.code, existingRecord.id);
                        }
                        if (record._originalId) {
                          if (!idMappings.tax_codesById) {
                            idMappings.tax_codesById = new Map();
                          }
                          idMappings.tax_codesById.set(record._originalId, existingRecord.id);
                        }
                      }
                    } else {
                      console.warn(`  ⚠️  Could not find existing ${tableName} record for mapping (code: ${record?.code}, name: ${record?.name})`);
                    }
                  }
                } catch (findError) {
                  console.warn(`  ⚠️  Error finding existing ${tableName} record for mapping: ${findError.message}`);
                }
                
                // Track skipped records so we don't add generic "error was not captured" messages
                if (!results.details[tableName].skipped) {
                  results.details[tableName].skipped = 0;
                }
                results.details[tableName].skipped++;
                // Don't count as failed - record already exists within this company, which is acceptable
                // Continue to next record (mapping already done above if record was found)
                continue;
              }
              
              // Handle validation errors that include uniqueness messages
              // Note: Validation should also be company-scoped
              if (error.name === 'SequelizeValidationError' && error.errors) {
                const isUniquenessError = error.errors.some(e => 
                  e.message && (e.message.includes('must be unique') || e.message.includes('unique'))
                );
                if (isUniquenessError) {
                  
                  // CRITICAL: Find the existing record and add it to mappings (same as unique constraint error)
                  try {
                    const Model = this.models[this.getModelName(tableName)];
                    if (Model) {
                      let existingRecord = null;
                      if (record.code) {
                        existingRecord = await Model.findOne({
                          where: { code: record.code, companyId },
                          transaction: tableTransaction
                        });
                      }
                      if (!existingRecord && record.name) {
                        existingRecord = await Model.findOne({
                          where: { name: record.name, companyId },
                          transaction: tableTransaction
                        });
                      }
                      if (existingRecord) {
                        newRecord = existingRecord;
                        // Add to mappings (same logic as above)
                        if (tableName === 'accounts') {
                          if (record._originalId) idMappings.accounts.set(record._originalId, existingRecord.id);
                          if (record.code) idMappings.accountsByCode.set(record.code, existingRecord.id);
                        }
                        if (tableName === 'currencies') {
                          if (record._originalId) idMappings.currencies.set(record._originalId, existingRecord.id);
                          if (record.code) idMappings.currenciesByCode.set(record.code, existingRecord.id);
                        }
                        if (tableName === 'account_types') {
                          if (record._originalId) idMappings.account_types.set(record._originalId, existingRecord.id);
                          if (record.code) idMappings.account_typesByCode.set(record.code, existingRecord.id);
                          if (record.name) {
                            idMappings.account_typesByName = idMappings.account_typesByName || new Map();
                            idMappings.account_typesByName.set(record.name.toUpperCase(), existingRecord.id);
                          }
                        }
                        if (tableName === 'payment_methods') {
                          if (!idMappings.payment_methods) idMappings.payment_methods = new Map();
                          if (record.code) idMappings.payment_methods.set(record.code, existingRecord.id);
                          if (record._originalId) idMappings.payment_methods.set(record._originalId, existingRecord.id);
                        }
                        if (tableName === 'stores' && record._originalId) {
                          idMappings.stores.set(record._originalId, existingRecord.id);
                        }
                        if (tableName === 'price_categories') {
                          if (record._originalId) idMappings.price_categories.set(record._originalId, existingRecord.id);
                          if (record.code) idMappings.price_categoriesByCode.set(record.code, existingRecord.id);
                        }
                        if (tableName === 'tax_codes') {
                          if (!idMappings.tax_codes) idMappings.tax_codes = new Map();
                          if (record.code) idMappings.tax_codes.set(record.code, existingRecord.id);
                          if (record._originalId) {
                            if (!idMappings.tax_codesById) idMappings.tax_codesById = new Map();
                            idMappings.tax_codesById.set(record._originalId, existingRecord.id);
                          }
                        }
                      }
                    }
                  } catch (findError) {
                    // Error finding existing record for mapping
                  }
                  
                  // Track skipped records
                  if (!results.details[tableName].skipped) {
                    results.details[tableName].skipped = 0;
                  }
                  results.details[tableName].skipped++;
                  // Don't count as failed - record already exists within this company, which is acceptable
                  continue;
                }
              }
              
              // Handle foreign key constraint errors - try to fix and retry
              if (error.name === 'SequelizeForeignKeyConstraintError' || 
                  (error.message && error.message.includes('foreign key constraint'))) {
                // Try to create record with nullified foreign keys
                try {
                  const fixedRecord = { ...record };
                  // Nullify problematic foreign keys based on error message
                  if (error.message.includes('created_by') || error.message.includes('createdBy')) {
                    fixedRecord.createdBy = userId; // Use current user
                  }
                  if (error.message.includes('updated_by') || error.message.includes('updatedBy')) {
                    fixedRecord.updatedBy = userId; // Use current user
                  }
                  if (error.message.includes('companyId') || error.message.includes('company_id')) {
                    fixedRecord.companyId = companyId; // Use current company
                  }
                  
                  // Try again with fixed record
                  const retrySavepoint = `sp_${tableName}_${i}_retry`;
                  await tableTransaction.sequelize.query(`SAVEPOINT ${retrySavepoint}`, { transaction: tableTransaction });
                  
                  try {
                    newRecord = await this.createRecord(
                      tableName, 
                      fixedRecord, 
                      companyId, 
                      userId, 
                      tableTransaction,
                      idMappings
                    );
                    await tableTransaction.sequelize.query(`RELEASE SAVEPOINT ${retrySavepoint}`, { transaction: tableTransaction });
                    created++;
                    results.successful++;
                    continue; // Success - move to next record
                  } catch (retryError) {
                    await tableTransaction.sequelize.query(`ROLLBACK TO SAVEPOINT ${retrySavepoint}`, { transaction: tableTransaction });
                    // Fall through to log error
                  }
                } catch (fixError) {
                  // Fall through to log error
                }
              }
              
              // Handle NOT NULL constraint errors - try to provide default values
              if (error.name === 'SequelizeDatabaseError' && 
                  (error.message.includes('null value') || error.message.includes('NOT NULL'))) {
                try {
                  const fixedRecord = { ...record };
                  // Provide defaults for common required fields
                  if (!fixedRecord.createdBy) fixedRecord.createdBy = userId;
                  if (!fixedRecord.updatedBy) fixedRecord.updatedBy = userId;
                  if (!fixedRecord.companyId) fixedRecord.companyId = companyId;
                  if (tableName === 'adjustment_reasons' && !fixedRecord.tracking_account_id) {
                    // Try to find a default account
                    const defaultAccount = idMappings.accounts ? Array.from(idMappings.accounts.values())[0] : null;
                    if (defaultAccount) fixedRecord.tracking_account_id = defaultAccount;
                  }
                  if (tableName === 'return_reasons' && !fixedRecord.refund_account_id) {
                    const defaultAccount = idMappings.accounts ? Array.from(idMappings.accounts.values())[0] : null;
                    if (defaultAccount) fixedRecord.refund_account_id = defaultAccount;
                  }
                  
                  // Try again with fixed record
                  const retrySavepoint = `sp_${tableName}_${i}_retry`;
                  await tableTransaction.sequelize.query(`SAVEPOINT ${retrySavepoint}`, { transaction: tableTransaction });
                  
                  try {
                    newRecord = await this.createRecord(
                      tableName, 
                      fixedRecord, 
                      companyId, 
                      userId, 
                      tableTransaction,
                      idMappings
                    );
                    await tableTransaction.sequelize.query(`RELEASE SAVEPOINT ${retrySavepoint}`, { transaction: tableTransaction });
                    created++;
                    results.successful++;
                    continue; // Success - move to next record
                  } catch (retryError) {
                    await tableTransaction.sequelize.query(`ROLLBACK TO SAVEPOINT ${retrySavepoint}`, { transaction: tableTransaction });
                    // Fall through to log error
                  }
                } catch (fixError) {
                  // Fall through to log error
                }
              }
              
              // If we get here, the error couldn't be automatically fixed
              // Log it but continue processing other records
              let errorMessage = 'Unknown error';
              if (error.message) {
                errorMessage = error.message;
              } else if (typeof error === 'string') {
                errorMessage = error;
              } else if (error.toString && error.toString() !== '[object Object]') {
                errorMessage = error.toString();
              }
              
              if (error.errors && Array.isArray(error.errors)) {
                const validationErrors = error.errors.map(e => `${e.path || e.field}: ${e.message || e.type}`).join(', ');
                errorMessage = `${errorMessage} (${validationErrors})`;
              }
              
              // If still no meaningful message, try to stringify the error
              if (errorMessage === 'Unknown error' && error) {
                try {
                  errorMessage = JSON.stringify(error, Object.getOwnPropertyNames(error)).substring(0, 200);
                } catch (e) {
                  errorMessage = String(error).substring(0, 200);
                }
              }
              
              // Always log errors for accounts and financial_years (critical tables)
              if (tableName === 'accounts' || tableName === 'financial_years') {
                console.error(`\n❌ CRITICAL ERROR creating ${tableName} record ${i + 1}:`, {
                  error: errorMessage,
                  errorName: error.name,
                  errorType: error.constructor.name,
                  hasErrors: !!error.errors,
                  errorDetails: error.errors?.map(e => ({ path: e.path, message: e.message, type: e.type, value: e.value }))
                });
              } else if (results.details[tableName].errors.length === 0) {
                // Only log first error for other tables to avoid spam
                console.error(`\n❌ Error creating ${tableName} record ${i + 1}:`, {
                  error: errorMessage,
                  errorName: error.name
                });
              }
              
              results.failed++;
              results.errors.push({
                table: tableName,
                recordIndex: i,
                error: errorMessage
              });
              results.details[tableName].errors.push({
                index: i,
                error: errorMessage
              });
              
              // Continue to next record - NEVER abort
              continue;
            }
          }
          
          // Commit transaction for this table - even if some records failed
          // We commit what we can, errors are logged but don't stop the process
          try {
            await tableTransaction.commit();
            if (created === 0 && records.length > 0) {
              const skipped = results.details[tableName].skipped || 0;
              const failed = results.details[tableName].errors.length;
              
              if (skipped === records.length) {
                // All records were skipped (already exist) - this is OK, not an error
              } else if (failed === records.length) {
                // All records failed - this is an error
                console.error(`  ⚠️  WARNING: ${tableName} had ${records.length} records but all failed!`);
                console.error(`     Check errors logged above.`);
              } else {
                // Mixed: some skipped, some failed
                console.error(`  ⚠️  WARNING: ${tableName} had ${records.length} records: ${skipped} skipped, ${failed} failed, 0 created`);
              }
              
              // Only add generic errors if we have failures but no error details were captured
              if (failed > 0 && results.details[tableName].errors.length === 0) {
                console.error(`  🔍 Adding generic errors for ${tableName} - errors were not captured during processing`);
                for (let i = 0; i < records.length; i++) {
                  // Skip if this record was already skipped (we track this separately)
                  const errorMessage = `Record creation failed - error was not captured. Check server logs for details.`;
                  results.failed++;
                  results.errors.push({
                    table: tableName,
                    recordIndex: i,
                    error: errorMessage
                  });
                  results.details[tableName].errors.push({
                    index: i,
                    error: errorMessage
                  });
                }
              }
            }
          } catch (commitError) {
            // If commit fails, try to rollback and continue with next table
            console.error(`  ⚠️  Commit error for ${tableName}: ${commitError.message}`);
            try {
              await tableTransaction.rollback();
            } catch (rollbackError) {
              console.error(`  ⚠️  Rollback also failed for ${tableName}: ${rollbackError.message}`);
            }
            // Continue to next table - don't abort entire initialization
          }
        } catch (tableError) {
          // If table transaction setup fails, log and continue to next table
          console.error(`  ⚠️  Table transaction error for ${tableName}:`, tableError.message);
          console.error(`     Error stack:`, tableError.stack?.substring(0, 300));
          
          // Always log critical table errors in detail
          if (tableName === 'accounts' || tableName === 'financial_years') {
            console.error(`\n❌ CRITICAL: Table-level error for ${tableName}:`, {
              errorName: tableError.name,
              message: tableError.message,
              stack: tableError.stack?.substring(0, 500)
            });
          }
          
          // Add error to results if we have records but none were created
          if (records.length > 0 && created === 0) {
            const errorMessage = `Table transaction failed: ${tableError.message}`;
            results.failed += records.length;
            for (let i = 0; i < records.length; i++) {
              results.errors.push({
                table: tableName,
                recordIndex: i,
                error: errorMessage
              });
              results.details[tableName].errors.push({
                index: i,
                error: errorMessage
              });
            }
          }
          
          // Don't rollback - transaction might not have started
          // Continue to next table - NEVER abort
        }

        results.details[tableName].created = created;
      }

      // Resolve foreign key references (second pass) - use a new transaction
      if (progressCallback) {
        progressCallback({
          stage: 'resolving',
          message: 'Resolving foreign key references...',
          progress: 0,
          total: 1
        });
      }

      // Resolve foreign keys - this is non-critical, so we continue even if it fails
      const resolveTransaction = await this.sequelize.transaction();
      try {
        await this.resolveForeignKeys(companyId, userId, resolveTransaction, idMappings);
        await resolveTransaction.commit();
      } catch (resolveError) {
        // Foreign key resolution is not critical - continue
        try {
          await resolveTransaction.rollback();
        } catch (rollbackError) {
          console.error('  ⚠️  Rollback error during foreign key resolution:', rollbackError.message);
        }
        // Continue - foreign keys can be resolved later manually if needed
      }

      // Always return success if ANY data was created successfully
      // The system should never "fail" - it should create what it can
      const hasSuccess = results.successful > 0;
      const message = hasSuccess 
        ? `Company initialization completed. ${results.successful} records created successfully${results.failed > 0 ? `, ${results.failed} records skipped or had errors` : ''}.`
        : 'No records were created. Please check the error logs.';
      
      return {
        success: hasSuccess, // Only false if nothing was created at all
        message: message,
        ...results
      };
    } catch (error) {
      // Even if there's an outer error, we should return what we have
      // Individual transactions are already committed/rolled back
      console.error('❌ Outer error in initialization (should not happen):', error.message);
      
      // Return partial results if we have any
      const hasSuccess = results.successful > 0;
      return {
        success: hasSuccess,
        message: hasSuccess 
          ? `Initialization completed with some errors. ${results.successful} records created.`
          : 'Initialization encountered errors. Please check logs.',
        ...results,
        outerError: error.message
      };
    }
  }

  /**
   * Create a single record in the database
   */
  async createRecord(tableName, recordData, companyId, userId, transaction, idMappings = {}) {
    // Map table names to model names
    const modelMap = {
      'stores': 'Store',
      'accounts': 'Account',
      'financial_years': 'FinancialYear',
      'customer_groups': 'CustomerGroup',
      'linked_accounts': 'LinkedAccount',
      'product_categories': 'ProductCategory',
      'packaging': 'Packaging',
      'tax_codes': 'TaxCode',
      'adjustment_reasons': 'AdjustmentReason',
      'return_reasons': 'ReturnReason',
      'price_categories': 'PriceCategory',
      'currencies': 'Currency',
      'account_types': 'AccountType',
      'exchange_rates': 'ExchangeRate',
      'payment_methods': 'PaymentMethod',
      'payment_types': 'PaymentType',
    };

    const modelName = modelMap[tableName];
    if (!modelName || !this.models[modelName]) {
      throw new Error(`Model not found for table: ${tableName}`);
    }

    const Model = this.models[modelName];

    // Prepare data for insertion
    const insertData = {
      ...recordData,
      id: uuidv4(), // Generate new UUID
      companyId: companyId, // Ensure companyId is set
    };
    
    // Ensure companyId is explicitly set (in case recordData has companyId that conflicts)
    insertData.companyId = companyId;

    // Handle created_by and updated_by fields (use userId)
    if (Model.rawAttributes.createdBy || Model.rawAttributes.created_by) {
      insertData.createdBy = userId;
      insertData.created_by = userId;
    }
    if (Model.rawAttributes.updatedBy || Model.rawAttributes.updated_by) {
      insertData.updatedBy = userId;
      insertData.updated_by = userId;
    }

    // Handle account_type_id for accounts - map to new account type ID
    if (tableName === 'accounts' && (recordData.accountTypeId || recordData.account_type_id)) {
      const accountTypeId = recordData.accountTypeId || recordData.account_type_id;
      // Map old account type ID to new account type ID
      if (idMappings.account_types && idMappings.account_types.has(accountTypeId)) {
        insertData.accountTypeId = idMappings.account_types.get(accountTypeId);
        insertData.account_type_id = idMappings.account_types.get(accountTypeId);
      } else {
        // Account type not found - set to null (field is nullable)
        insertData.accountTypeId = null;
        insertData.account_type_id = null;
      }
    }
    
    // Handle currency IDs for exchange_rates - map from_currency_id and to_currency_id
    if (tableName === 'exchange_rates') {
      // Map from_currency_id
      if (recordData.from_currency_id) {
        if (idMappings.currencies && idMappings.currencies.has(recordData.from_currency_id)) {
          insertData.from_currency_id = idMappings.currencies.get(recordData.from_currency_id);
        } else {
          // Currency not found - this is required, so we'll skip this record
          throw new Error(`from_currency_id ${recordData.from_currency_id} not found in currency mappings`);
        }
      }
      // Map to_currency_id
      if (recordData.to_currency_id) {
        if (idMappings.currencies && idMappings.currencies.has(recordData.to_currency_id)) {
          insertData.to_currency_id = idMappings.currencies.get(recordData.to_currency_id);
        } else {
          // Currency not found - this is required, so we'll skip this record
          throw new Error(`to_currency_id ${recordData.to_currency_id} not found in currency mappings`);
        }
      }
    }

    // Handle financial_years - ensure isCurrent is set correctly (only one current year per company)
    // Note: isCurrent is already set to true in the records array, but we verify here
    // The model hook will handle ensuring only one current year per company
    if (tableName === 'financial_years') {
      // The financial year is already set as current in the records array
      // The model's beforeCreate hook will handle ensuring only one current year
      // So we don't need to check here - just ensure isCurrent is true
      insertData.isCurrent = true;
    }

    // Handle account parentId - resolve using original ID mapping
    if (tableName === 'accounts' && recordData.parentId) {
      // parentId is the original parent account ID, map it to new ID
      if (idMappings.accounts && idMappings.accounts.has(recordData.parentId)) {
        insertData.parentId = idMappings.accounts.get(recordData.parentId);
      } else {
        insertData.parentId = null; // Will be resolved later if parent not created yet
      }
    }

    // Handle store foreign keys - resolve using original ID mapping
    if (tableName === 'stores') {
      if (recordData.default_currency_id && idMappings.currencies && idMappings.currencies.has(recordData.default_currency_id)) {
        insertData.default_currency_id = idMappings.currencies.get(recordData.default_currency_id);
      } else {
        insertData.default_currency_id = null; // Will be resolved later
      }
      if (recordData.default_price_category_id && idMappings.price_categories && idMappings.price_categories.has(recordData.default_price_category_id)) {
        insertData.default_price_category_id = idMappings.price_categories.get(recordData.default_price_category_id);
      } else {
        insertData.default_price_category_id = null; // Will be resolved later
      }
    }

    // Handle linked_accounts - account_id will be resolved after accounts are created
    if (tableName === 'linked_accounts' && recordData.account_id) {
      // account_id is the original account ID, map it to new ID
      if (idMappings.accounts && idMappings.accounts.has(recordData.account_id)) {
        insertData.account_id = idMappings.accounts.get(recordData.account_id);
      } else {
        insertData.account_id = null; // Will be resolved later
      }
    }

    // Handle payment_types - payment_method_id (need to track payment methods)
    if (tableName === 'payment_types' && recordData.payment_method_id) {
      // Will be resolved later - payment methods don't have _originalId yet
      insertData.payment_method_id = null; // Will be resolved later
    }

    // Handle customer_groups - account_receivable_id and default_liability_account_id
    if (tableName === 'customer_groups') {
      if (recordData.account_receivable_id && idMappings.accounts && idMappings.accounts.has(recordData.account_receivable_id)) {
        insertData.account_receivable_id = idMappings.accounts.get(recordData.account_receivable_id);
      } else {
        insertData.account_receivable_id = null;
      }
      if (recordData.default_liability_account_id && idMappings.accounts && idMappings.accounts.has(recordData.default_liability_account_id)) {
        insertData.default_liability_account_id = idMappings.accounts.get(recordData.default_liability_account_id);
      } else {
        insertData.default_liability_account_id = null;
      }
    }

    // Handle product_categories - tax_code_id, purchases_tax_id, cogs_account_id, income_account_id, asset_account_id
    if (tableName === 'product_categories') {
      // These will be resolved in the second pass since tax_codes and accounts need to be created first
      // Store original IDs for later resolution (keep them in the record for resolveForeignKeys)
      insertData.tax_code_id = null;
      insertData.purchases_tax_id = null;
      insertData.cogs_account_id = null;
      insertData.income_account_id = null;
      insertData.asset_account_id = null;
    }

    // Handle tax_codes - sales_tax_account_id, purchases_tax_account_id
    if (tableName === 'tax_codes') {
      if (recordData.sales_tax_account_id && idMappings.accounts && idMappings.accounts.has(recordData.sales_tax_account_id)) {
        insertData.sales_tax_account_id = idMappings.accounts.get(recordData.sales_tax_account_id);
      } else {
        insertData.sales_tax_account_id = null;
      }
      if (recordData.purchases_tax_account_id && idMappings.accounts && idMappings.accounts.has(recordData.purchases_tax_account_id)) {
        insertData.purchases_tax_account_id = idMappings.accounts.get(recordData.purchases_tax_account_id);
      } else {
        insertData.purchases_tax_account_id = null;
      }
    }

    // Handle adjustment_reasons - tracking_account_id, corresponding_account_id
    if (tableName === 'adjustment_reasons') {
      if (recordData.tracking_account_id && idMappings.accounts && idMappings.accounts.has(recordData.tracking_account_id)) {
        insertData.tracking_account_id = idMappings.accounts.get(recordData.tracking_account_id);
      } else {
        insertData.tracking_account_id = null;
      }
      if (recordData.corresponding_account_id && idMappings.accounts && idMappings.accounts.has(recordData.corresponding_account_id)) {
        insertData.corresponding_account_id = idMappings.accounts.get(recordData.corresponding_account_id);
      } else {
        insertData.corresponding_account_id = null;
      }
    }

    // Handle return_reasons - refund_account_id, inventory_account_id
    if (tableName === 'return_reasons') {
      if (recordData.refund_account_id && idMappings.accounts && idMappings.accounts.has(recordData.refund_account_id)) {
        insertData.refund_account_id = idMappings.accounts.get(recordData.refund_account_id);
      } else {
        insertData.refund_account_id = null;
      }
      if (recordData.inventory_account_id && idMappings.accounts && idMappings.accounts.has(recordData.inventory_account_id)) {
        insertData.inventory_account_id = idMappings.accounts.get(recordData.inventory_account_id);
      } else {
        insertData.inventory_account_id = null;
      }
    }

    // Handle payment_types - default_account_id
    if (tableName === 'payment_types') {
      if (recordData.default_account_id && idMappings.accounts && idMappings.accounts.has(recordData.default_account_id)) {
        insertData.default_account_id = idMappings.accounts.get(recordData.default_account_id);
      } else {
        insertData.default_account_id = null;
      }
    }
    
    // Remove _originalId from insert data
    delete insertData._originalId;

    // Create the record
    // For financial_years, skip Sequelize validation to avoid uniqueness check
    // The database composite unique constraint will handle per-company uniqueness
    const createOptions = { transaction };
    if (tableName === 'financial_years') {
      // Skip validation for financial years - let database handle uniqueness
      createOptions.validate = false;
    }
    
    try {
      const created = await Model.create(insertData, createOptions);
      return created;
    } catch (createError) {
      // Log detailed error before re-throwing
      if (createError.errors && Array.isArray(createError.errors)) {
        console.error(`\n❌ Create error for ${tableName}:`, {
          errorName: createError.name,
          message: createError.message,
          validationErrors: createError.errors.map(e => ({
            path: e.path,
            message: e.message,
            value: e.value
          })),
          insertData: JSON.stringify(insertData, null, 2).substring(0, 1000)
        });
      } else {
        console.error(`\n❌ Create error for ${tableName}:`, {
          errorName: createError.name,
          message: createError.message,
          insertData: JSON.stringify(insertData, null, 2).substring(0, 1000)
        });
      }
      throw createError;
    }
  }

  /**
   * Resolve foreign key references after initial creation
   */
  async resolveForeignKeys(companyId, userId, transaction, idMappings) {
    // Resolve account parentId references that weren't resolved during creation
    if (this.initialData.tables.accounts) {
      const accountsData = this.initialData.tables.accounts;
      
      for (const accountData of accountsData) {
        if (accountData.parentId && accountData._originalId && accountData.code) {
          const newAccountId = idMappings.accounts.get(accountData._originalId);
          const newParentId = idMappings.accounts.get(accountData.parentId);
          
          if (newAccountId && newParentId) {
            await this.models.Account.update(
              { parentId: newParentId },
              { where: { id: newAccountId, companyId }, transaction }
            );
          }
        }
      }
    }

    // Resolve linked_accounts.account_id that weren't resolved
    if (this.initialData.tables.linked_accounts) {
      const linkedAccountsData = this.initialData.tables.linked_accounts;
      
      for (const linkedAccountData of linkedAccountsData) {
        if (linkedAccountData.account_id) {
          const newAccountId = idMappings.accounts.get(linkedAccountData.account_id);
          
          if (newAccountId) {
            // Find the linked account record (we'll need to track it during creation)
            // For now, find by account_type
            await this.models.LinkedAccount.update(
              { account_id: newAccountId },
              { 
                where: { 
                  companyId,
                  account_type: linkedAccountData.account_type
                },
                transaction
              }
            );
          }
        }
      }
    }

    // Resolve store foreign keys that weren't resolved
    if (this.initialData.tables.stores) {
      const storesData = this.initialData.tables.stores;
      
      for (const storeData of storesData) {
        if (storeData._originalId) {
          const newStoreId = idMappings.stores.get(storeData._originalId);
          
          if (newStoreId) {
            const updates = {};
            
            if (storeData.default_currency_id && idMappings.currencies.has(storeData.default_currency_id)) {
              updates.default_currency_id = idMappings.currencies.get(storeData.default_currency_id);
            }
            
            if (storeData.default_price_category_id && idMappings.price_categories.has(storeData.default_price_category_id)) {
              updates.default_price_category_id = idMappings.price_categories.get(storeData.default_price_category_id);
            }
            
            if (Object.keys(updates).length > 0) {
              await this.models.Store.update(
                updates,
                { where: { id: newStoreId, companyId }, transaction }
              );
            }
          }
        }
      }
    }

    // Resolve customer_groups foreign keys
    if (this.initialData.tables.customer_groups) {
      const customerGroupsData = this.initialData.tables.customer_groups;
      
      for (const groupData of customerGroupsData) {
        if (groupData.group_code) {
          const updates = {};
          
          if (groupData.account_receivable_id && idMappings.accounts.has(groupData.account_receivable_id)) {
            updates.account_receivable_id = idMappings.accounts.get(groupData.account_receivable_id);
          }
          
          if (groupData.default_liability_account_id && idMappings.accounts.has(groupData.default_liability_account_id)) {
            updates.default_liability_account_id = idMappings.accounts.get(groupData.default_liability_account_id);
          }
          
          if (Object.keys(updates).length > 0) {
            await this.models.CustomerGroup.update(
              updates,
              { where: { group_code: groupData.group_code, companyId }, transaction }
            );
          }
        }
      }
    }

    // Resolve product_categories foreign keys
    if (this.initialData.tables.product_categories) {
      const productCategoriesData = this.initialData.tables.product_categories;
      
      for (const categoryData of productCategoriesData) {
        if (categoryData.code) {
          const updates = {};
          
          // Resolve tax codes by original ID
          if (categoryData.tax_code_id && idMappings.tax_codesById && idMappings.tax_codesById.has(categoryData.tax_code_id)) {
            updates.tax_code_id = idMappings.tax_codesById.get(categoryData.tax_code_id);
          }
          if (categoryData.purchases_tax_id && idMappings.tax_codesById && idMappings.tax_codesById.has(categoryData.purchases_tax_id)) {
            updates.purchases_tax_id = idMappings.tax_codesById.get(categoryData.purchases_tax_id);
          }
          
          // Resolve accounts by original ID
          if (categoryData.cogs_account_id && idMappings.accounts.has(categoryData.cogs_account_id)) {
            updates.cogs_account_id = idMappings.accounts.get(categoryData.cogs_account_id);
          }
          if (categoryData.income_account_id && idMappings.accounts.has(categoryData.income_account_id)) {
            updates.income_account_id = idMappings.accounts.get(categoryData.income_account_id);
          }
          if (categoryData.asset_account_id && idMappings.accounts.has(categoryData.asset_account_id)) {
            updates.asset_account_id = idMappings.accounts.get(categoryData.asset_account_id);
          }
          
          if (Object.keys(updates).length > 0) {
            await this.models.ProductCategory.update(
              updates,
              { where: { code: categoryData.code, companyId }, transaction }
            );
          }
        }
      }
    }

    // Resolve payment_types payment_method_id and default_account_id
    if (this.initialData.tables.payment_types) {
      const paymentTypesData = this.initialData.tables.payment_types;
      
      for (const paymentTypeData of paymentTypesData) {
        if (paymentTypeData.code) {
          const updates = {};
          
          // Resolve payment_method_id by code (if we tracked it)
          if (paymentTypeData.payment_method_id && idMappings.payment_methods) {
            // This would need the original payment_method code stored
            // For now, we'll skip this and handle it in createRecord if possible
          }
          
          // Resolve default_account_id
          if (paymentTypeData.default_account_id && idMappings.accounts.has(paymentTypeData.default_account_id)) {
            updates.default_account_id = idMappings.accounts.get(paymentTypeData.default_account_id);
          }
          
          if (Object.keys(updates).length > 0) {
            await this.models.PaymentType.update(
              updates,
              { where: { code: paymentTypeData.code, companyId }, transaction }
            );
          }
        }
      }
    }
  }

}

module.exports = CompanyInitializationService;

