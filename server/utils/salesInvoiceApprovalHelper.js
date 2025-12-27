const { Op } = require('sequelize');
const { 
  GeneralLedger, 
  Customer, 
  LoyaltyTransaction, 
  PriceHistory, 
  ProductExpiryDate, 
  ProductSerialNumber, 
  ProductTransaction,
  SalesTransaction,
  SalesInvoiceItem,
  Account,
  AccountType,
  Currency,
  FinancialYear,
  TransactionType,
  Product,
  ProductCategory,
  ProductStore,
  LoyaltyCard,
  LoyaltyCardConfig,
  Store,
  TaxCode,
  sequelize
} = require('../models');
const ProductTransactionService = require('./productTransactionService');
const { buildCompanyWhere } = require('../middleware/companyFilter');

/**
 * Approve a sales invoice and save data to all related tables
 * 
 * This function handles the complete approval flow and updates all 8 required tables:
 * 1. General Ledger - Creates accounting entries (COGS, Inventory, AR, Revenue, Tax, WHT, Discount)
 * 2. Customers - Updates debt_balance and account_balance
 * 3. Loyalty Cards Transactions - Creates loyalty transaction if customer has loyalty card
 * 4. Price Change History - Logs price changes for products
 * 5. Product Expiry - Updates batch number quantities
 * 6. Product Serial Numbers - Marks serial numbers as sold
 * 7. Product Transactions - Creates inventory movement records
 * 8. Sales Transaction - Creates or updates sales transaction record
 * 
 * Features:
 * - Comprehensive validation (stock, serial numbers, batch numbers)
 * - Proper currency conversion (invoice currency ↔ system currency)
 * - Critical vs non-critical error handling
 * - All operations wrapped in database transaction
 * - Creates sales transaction if missing
 * 
 * @param {Object} invoice - SalesInvoice instance (with items loaded)
 * @param {Object} req - Express request object (for user and companyId)
 * @param {Object} transaction - Sequelize transaction
 * @returns {Promise<Object>} Approval result with details of all operations
 */
async function approveSalesInvoice(invoice, req, transaction) {
  const results = {
    generalLedger: [],
    customerUpdated: false,
    loyaltyTransaction: null,
    priceHistory: [],
    productExpiry: [],
    productSerial: [],
    productTransactions: [],
    salesTransaction: null,
    errors: []
  };

  try {
    // Get user info
    const user = req.user;
    const companyId = user.companyId;
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;

    // Load invoice with all necessary associations
    // Use the SalesInvoice model directly instead of invoice.constructor
    const { SalesInvoice: SalesInvoiceModel } = require('../models');
    const fullInvoice = await SalesInvoiceModel.findOne({
      where: buildCompanyWhere(req, { id: invoice.id }),
      include: [
        {
          model: SalesInvoiceItem,
          as: 'items',
          include: [
            {
              model: Product,
              as: 'product',
              include: [
                {
                  model: ProductCategory,
                  as: 'category'
                }
              ]
            },
            {
              model: TaxCode,
              as: 'salesTaxCode',
              attributes: ['id', 'code', 'name', 'rate', 'sales_tax_account_id', 'is_wht'],
              required: false
            },
            {
              model: TaxCode,
              as: 'whtTaxCode',
              attributes: ['id', 'code', 'name', 'rate', 'sales_tax_account_id', 'is_wht'],
              required: false
            }
          ]
        },
        {
          model: Customer,
          as: 'customer'
        },
        {
          model: Store,
          as: 'store'
        },
        {
          model: FinancialYear,
          as: 'financialYear'
        },
        {
          model: Currency,
          as: 'currency'
        }
      ],
      transaction
    });

    if (!fullInvoice) {
      throw new Error('Invoice not found');
    }

    // Get customer from invoice
    const customer = fullInvoice.customer;
    if (!customer) {
      throw new Error('Customer not found in invoice. Please ensure the invoice has a valid customer assigned.');
    }

    // Validate invoice has items
    if (!fullInvoice.items || fullInvoice.items.length === 0) {
      throw new Error('Invoice has no items. Cannot approve an invoice without items.');
    }

    // Get system default currency
    const systemCurrency = await Currency.findOne({
      where: buildCompanyWhere(req, { is_default: true }),
      transaction
    });

    if (!systemCurrency) {
      throw new Error('System default currency not found. Please ensure your company has a default currency configured in Company Setup.');
    }

    // Get financial year
    const financialYear = fullInvoice.financialYear || await FinancialYear.findOne({
      where: buildCompanyWhere(req, { isActive: true }),
      transaction
    });

    if (!financialYear) {
      throw new Error('Financial year not found. Please ensure your company has an active financial year configured.');
    }

    // Get sales transaction type
    // Try to find by code first (with companyId)
    let salesTransactionType = await TransactionType.findOne({
      where: buildCompanyWhere(req, { code: 'SALES_INVOICE' }),
      transaction
    });

    // If not found by code, try to find by name (with companyId)
    if (!salesTransactionType) {
      salesTransactionType = await TransactionType.findOne({
        where: buildCompanyWhere(req, { name: 'Sales Invoice' }),
        transaction
      });
    }

    // If still not found, try to find globally (companyId is null)
    if (!salesTransactionType) {
      salesTransactionType = await TransactionType.findOne({
        where: { code: 'SALES_INVOICE', companyId: null },
        transaction
      });
    }

    // If still not found, try to find by name globally
    if (!salesTransactionType) {
      salesTransactionType = await TransactionType.findOne({
        where: { name: 'Sales Invoice', companyId: null },
        transaction
      });
    }

    // Only create if it truly doesn't exist
    if (!salesTransactionType) {
      try {
        salesTransactionType = await TransactionType.create({
          code: 'SALES_INVOICE',
          name: 'Sales Invoice',
          description: 'Sales invoice transactions',
          companyId: companyId
        }, { transaction });
      } catch (createError) {
        // If creation fails due to unique constraint, try to find the existing one
        if (createError.name === 'SequelizeUniqueConstraintError') {
          salesTransactionType = await TransactionType.findOne({
            where: buildCompanyWhere(req, { name: 'Sales Invoice' }),
            transaction
          });
          if (!salesTransactionType) {
            salesTransactionType = await TransactionType.findOne({
              where: { name: 'Sales Invoice', companyId: null },
              transaction
            });
          }
        } else {
          throw createError;
        }
      }
    }

    // Ensure salesTransactionType is defined
    if (!salesTransactionType) {
      throw new Error('Sales transaction type not found and could not be created');
    }

    // Validate invoice has items
    if (!fullInvoice.items || fullInvoice.items.length === 0) {
      throw new Error('Invoice must have at least one item to approve');
    }

    // Validate all products exist
    for (const item of fullInvoice.items) {
      if (!item.product) {
        throw new Error(`Product not found for item ${item.id || 'unknown'}`);
      }
    }

    // Generate unique reference for GL entries (group all entries)
    const glParentId = require('crypto').randomUUID();
    const exchangeRate = parseFloat(fullInvoice.exchange_rate || 1);
    const invoiceDate = new Date(fullInvoice.invoice_date);

    // ============================================
    // VALIDATION: Stock Availability, Serial Numbers, Batch Numbers
    // ============================================
    try {
      if (!fullInvoice.store_id) {
        throw new Error('Store ID is required for invoice approval');
      }

      for (const item of fullInvoice.items) {
        if (!item.product_id) {
          throw new Error('Product ID is required for all invoice items');
        }

        const product = item.product;
        if (!product) {
          throw new Error(`Product not found for item ${item.id || 'unknown'}`);
        }

        const quantity = parseFloat(item.quantity || 0);
        
        if (quantity <= 0) {
          throw new Error(`Invalid quantity for product ${product.name || item.product_id}: ${quantity}`);
        }

        // Skip stock validation for services products (services don't have stock)
        const productType = product.product_type || product.productType;
        if (productType !== 'services') {
          // Validate stock availability
          const productStore = await ProductStore.findOne({
            where: buildCompanyWhere(req, {
              product_id: item.product_id,
              store_id: fullInvoice.store_id
            }),
            transaction
          });

          if (!productStore) {
            throw new Error(`Product "${product.name || item.product_id}" is not available in the selected store. Please add the product to the store inventory first.`);
          }

          const currentQuantity = parseFloat(productStore.quantity || 0);
          
          // Check if product has no quantity (zero or negative)
          if (currentQuantity <= 0) {
            throw new Error(`Product "${product.name || item.product_id}" has no available stock in the store. Current quantity: ${currentQuantity}. Cannot approve invoice with this product.`);
          }
          
          // Check if available quantity is less than required
          if (currentQuantity < quantity) {
            throw new Error(`Insufficient stock for product "${product.name || item.product_id}". Available: ${currentQuantity}, Required: ${quantity}. Cannot approve invoice.`);
          }
        }

        // Validate batch numbers and quantities
        if (item.batch_number && item.expiry_date) {
          const batchNumber = item.batch_number.trim();
          
          // Parse invoice expiry date - extract date components directly to avoid timezone issues
          let invoiceDateStr;
          if (typeof item.expiry_date === 'string') {
            // Extract date part only (YYYY-MM-DD format)
            invoiceDateStr = item.expiry_date.split('T')[0];
            // Validate format
            if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDateStr)) {
              throw new Error(`Invalid expiry date format for batch "${batchNumber}": ${item.expiry_date}`);
            }
          } else {
            // If it's a Date object, use UTC to avoid timezone shifts
            const invoiceDate = new Date(item.expiry_date);
            invoiceDateStr = `${invoiceDate.getUTCFullYear()}-${String(invoiceDate.getUTCMonth() + 1).padStart(2, '0')}-${String(invoiceDate.getUTCDate()).padStart(2, '0')}`;
          }

          const productExpiry = await ProductExpiryDate.findOne({
            where: buildCompanyWhere(req, {
              product_id: item.product_id,
              store_id: fullInvoice.store_id,
              batch_number: batchNumber
            }),
            transaction
          });

          if (!productExpiry) {
            throw new Error(`Batch number "${batchNumber}" not found for product "${product?.name || item.product_id}" in store`);
          }

          // Extract date from database using UTC to avoid timezone shifts
          const dbExpiryDate = new Date(productExpiry.expiry_date);
          const dbDateStr = `${dbExpiryDate.getUTCFullYear()}-${String(dbExpiryDate.getUTCMonth() + 1).padStart(2, '0')}-${String(dbExpiryDate.getUTCDate()).padStart(2, '0')}`;
          
          // Compare date strings (YYYY-MM-DD format) to avoid timezone issues
          if (dbDateStr !== invoiceDateStr) {
            throw new Error(`Expiry date mismatch for batch "${batchNumber}". Expected: ${invoiceDateStr}, Found: ${dbDateStr}`);
          }

          const batchQuantity = parseFloat(productExpiry.current_quantity || 0);
          if (batchQuantity < quantity) {
            throw new Error(`Insufficient batch quantity for "${batchNumber}". Available: ${batchQuantity}, Required: ${quantity}`);
          }
        }

        // Validate serial numbers
        if (item.serial_numbers && Array.isArray(item.serial_numbers) && item.serial_numbers.length > 0) {
          for (const serialNumber of item.serial_numbers) {
            const serial = String(serialNumber).trim();
            
            if (serial) {
              const productSerial = await ProductSerialNumber.findOne({
                where: buildCompanyWhere(req, {
                  product_id: item.product_id,
                  store_id: fullInvoice.store_id,
                  serial_number: serial
                }),
                transaction
              });

              if (!productSerial) {
                throw new Error(`Serial number "${serial}" not found for product "${product?.name || item.product_id}" in store`);
              }

              if (productSerial.status !== 'active') {
                throw new Error(`Serial number "${serial}" is not active (status: ${productSerial.status}). This serial number may have already been sold. Please remove it from the invoice or check other transactions.`);
              }

              const serialQuantity = parseFloat(productSerial.current_quantity || 0);
              if (serialQuantity < 1) {
                throw new Error(`Serial number "${serial}" has insufficient quantity. Available: ${serialQuantity}, Required: 1. This serial number may have already been sold in another transaction. Please remove it from the invoice item or check the serial number record.`);
              }
            }
          }
        }
      }
    } catch (validationError) {
      throw new Error(`Validation failed: ${validationError.message}`);
    }

    // Get transaction type for sales (reuse for product transactions)
    let salesType = null;
    const getSalesTransactionType = async () => {
      if (salesType) return salesType;
      
      // Try to find by code first (with companyId)
      salesType = await TransactionType.findOne({
        where: buildCompanyWhere(req, { code: 'SALE' }),
        transaction
      });

      // If not found by code, try to find by name (with companyId)
      if (!salesType) {
        salesType = await TransactionType.findOne({
          where: buildCompanyWhere(req, { name: 'Sale' }),
          transaction
        });
      }

      // If still not found, try to find globally (companyId is null)
      if (!salesType) {
        salesType = await TransactionType.findOne({
          where: { code: 'SALE', companyId: null },
          transaction
        });
      }

      // If still not found, try to find by name globally
      if (!salesType) {
        salesType = await TransactionType.findOne({
          where: { name: 'Sale', companyId: null },
          transaction
        });
      }

      // Only create if it truly doesn't exist
      if (!salesType) {
        try {
          salesType = await TransactionType.create({
            code: 'SALE',
            name: 'Sale',
            description: 'Product sales transactions',
            companyId: companyId
          }, { transaction });
        } catch (createError) {
          // If creation fails due to unique constraint, try to find the existing one
          if (createError.name === 'SequelizeUniqueConstraintError') {
            salesType = await TransactionType.findOne({
              where: buildCompanyWhere(req, { name: 'Sale' }),
              transaction
            });
            if (!salesType) {
              salesType = await TransactionType.findOne({
                where: { name: 'Sale', companyId: null },
                transaction
              });
            }
          } else {
            throw createError;
          }
        }
      }
      
      return salesType;
    };

    // ============================================
    // 1. GENERAL LEDGER ENTRIES
    // ============================================
    // Note: All GL entries use the invoice's stored equivalent_amount proportionally
    // The accounting equation must balance: AR (debit) = REV (credit) - DISC (debit) + TAX (credit) - WHT (debit)
    // In invoice currency: balance_amount = subtotal - discount_amount + tax_amount - wht_amount
    // In system currency: AR equivalent = REV equivalent - DISC equivalent + TAX equivalent - WHT equivalent
    // All equivalent amounts are calculated proportionally from invoice.equivalent_amount
    try {
      // Calculate invoice totals once for reuse throughout GL entries
      const totalAmount = parseFloat(fullInvoice.total_amount || 0);
      const invoiceEquivalentAmount = parseFloat(fullInvoice.equivalent_amount || 0);
      const invoiceSubtotal = parseFloat(fullInvoice.subtotal || 0);
      // Calculate subtotal equivalent amount proportionally from total equivalent amount
      // This ensures revenue uses subtotal-based equivalent, not total-based
      const invoiceSubtotalEquivalentAmount = totalAmount > 0 && invoiceEquivalentAmount > 0
        ? (invoiceSubtotal / totalAmount) * invoiceEquivalentAmount
        : (exchangeRate > 0 ? invoiceSubtotal * exchangeRate : invoiceSubtotal);
      
      // For each invoice item: COGS Debit + Inventory Credit
      // Skip service products (they don't have COGS/Inventory)
      for (const item of fullInvoice.items || []) {
        const product = item.product;
        if (!product) {
          results.errors.push(`Product not found for item ${item.id || 'unknown'}`);
          continue;
        }

        // Skip service products - they don't have COGS or inventory
        if (product.product_type === 'services') {
          continue;
        }

        const category = product?.category;
        const quantity = parseFloat(item.quantity || 0);
        const averageCost = parseFloat(product?.average_cost || 0);
        const cogsAmount = quantity * averageCost; // This is in system currency
        
        // Skip if no cost (zero amount)
        if (cogsAmount <= 0) {
          continue;
        }

        // Exchange rate converts FROM invoice currency TO system currency
        // So to convert FROM system currency TO invoice currency, we divide
        const cogsAmountInInvoiceCurrency = exchangeRate > 0 ? cogsAmount / exchangeRate : cogsAmount;

        // Get COGS account (from category or product)
        const cogsAccountId = category?.cogs_account_id || product?.cogs_account_id;
        // Use asset_account_id (not inventory_account_id) - this is the inventory/asset account
        const inventoryAccountId = category?.asset_account_id || product?.asset_account_id;

        // Validate accounts exist
        if (!cogsAccountId) {
          results.errors.push(`COGS account not found for product "${product.name || product.code || 'unknown'}" (ID: ${product.id}). Please set cogs_account_id on product category or product.`);
          continue;
        }

        if (!inventoryAccountId) {
          results.errors.push(`Inventory/Asset account not found for product "${product.name || product.code || 'unknown'}" (ID: ${product.id}). Please set asset_account_id on product category or product.`);
          continue;
        }

        const cogsAccount = await Account.findByPk(cogsAccountId, { transaction });
        const inventoryAccount = await Account.findByPk(inventoryAccountId, { transaction });

        if (!cogsAccount) {
          results.errors.push(`COGS account with ID ${cogsAccountId} not found for product "${product.name || product.code || 'unknown'}".`);
          continue;
        }

        if (!inventoryAccount) {
          results.errors.push(`Inventory/Asset account with ID ${inventoryAccountId} not found for product "${product.name || product.code || 'unknown'}".`);
          continue;
        }

        const cogsAccountType = await AccountType.findByPk(cogsAccount.account_type_id, { transaction });
        const inventoryAccountType = await AccountType.findByPk(inventoryAccount.account_type_id, { transaction });

        // COGS Debit Entry
        const cogsEntry = await GeneralLedger.create({
          financial_year_code: financialYear.name,
          financial_year_id: financialYear.id,
          system_date: new Date(),
          transaction_date: invoiceDate,
          reference_number: `${fullInvoice.invoice_ref_number}-COGS-${item.id}`,
          transaction_type: 'SALES_INVOICE',
          transaction_type_name: 'Sales Invoice',
          transaction_type_id: salesTransactionType.id,
          created_by_code: user.id,
          created_by_name: userName,
          description: `COGS for ${product?.name || 'Product'} - Invoice ${fullInvoice.invoice_ref_number}`,
          account_type_code: cogsAccountType?.code || 'EXPENSE',
          account_type_name: cogsAccountType?.name || 'Cost of Sales',
          account_type_id: cogsAccountType?.id,
          account_id: cogsAccount.id,
          account_name: cogsAccount.name,
          account_code: cogsAccount.code,
          account_nature: 'debit',
          exchange_rate: exchangeRate,
          amount: cogsAmount,
          system_currency_id: systemCurrency.id,
          user_debit_amount: cogsAmountInInvoiceCurrency,
          equivalent_debit_amount: cogsAmount,
          username: user.username,
          general_ledger_id: glParentId,
          companyId: companyId
        }, { transaction });

        // Inventory Credit Entry
        const inventoryEntry = await GeneralLedger.create({
          financial_year_code: financialYear.name,
          financial_year_id: financialYear.id,
          system_date: new Date(),
          transaction_date: invoiceDate,
          reference_number: `${fullInvoice.invoice_ref_number}-INV-${item.id}`,
          transaction_type: 'SALES_INVOICE',
          transaction_type_name: 'Sales Invoice',
          transaction_type_id: salesTransactionType.id,
          created_by_code: user.id,
          created_by_name: userName,
          description: `Inventory for ${product?.name || 'Product'} - Invoice ${fullInvoice.invoice_ref_number}`,
          account_type_code: inventoryAccountType?.code || 'ASSET',
          account_type_name: inventoryAccountType?.name || 'Inventory',
          account_type_id: inventoryAccountType?.id,
          account_id: inventoryAccount.id,
          account_name: inventoryAccount.name,
          account_code: inventoryAccount.code,
          account_nature: 'credit',
          exchange_rate: exchangeRate,
          amount: cogsAmount,
          system_currency_id: systemCurrency.id,
          user_credit_amount: cogsAmountInInvoiceCurrency,
          equivalent_credit_amount: cogsAmount,
          username: user.username,
          general_ledger_id: glParentId,
          companyId: companyId
        }, { transaction });

        results.generalLedger.push(cogsEntry, inventoryEntry);
      }

      // Accounts Receivable Debit Entry
      // Use invoice's account_receivable_id as fallback if customer doesn't have default
      const receivableAccountId = customer?.default_receivable_account_id || fullInvoice.account_receivable_id;
      if (receivableAccountId) {
        const receivableAccount = await Account.findByPk(receivableAccountId, { transaction });
        if (receivableAccount) {
          const receivableAccountType = await AccountType.findByPk(receivableAccount.account_type_id, { transaction });
          // Use balance_amount (unpaid amount) - this is already in invoice currency
          // balance_amount = total_amount - paid_amount (the amount still owed by customer)
          const balanceAmount = parseFloat(fullInvoice.balance_amount || 0);
          // If balance_amount is not set, calculate it: total - paid
          const calculatedBalance = balanceAmount > 0 
            ? balanceAmount 
            : parseFloat(fullInvoice.total_amount || 0) - parseFloat(fullInvoice.paid_amount || 0);
          // Use invoice's equivalent_amount proportionally for balance_amount
          // equivalent_amount = total_amount * exchange_rate (stored on invoice)
          // AR equivalent should be proportional to balance_amount/total_amount ratio
          // Calculate equivalent amount for balance_amount proportionally
          // This ensures AR equivalent is based on the invoice's stored equivalent_amount
          const balanceAmountInSystemCurrency = totalAmount > 0 && invoiceEquivalentAmount > 0
            ? (calculatedBalance / totalAmount) * invoiceEquivalentAmount
            : (exchangeRate > 0 ? calculatedBalance * exchangeRate : calculatedBalance);
          const balanceAmountInInvoiceCurrency = calculatedBalance; // Already in invoice currency

          const arEntry = await GeneralLedger.create({
            financial_year_code: financialYear.name,
            financial_year_id: financialYear.id,
            system_date: new Date(),
            transaction_date: invoiceDate,
            reference_number: fullInvoice.invoice_ref_number,
            transaction_type: 'SALES_INVOICE',
            transaction_type_name: 'Sales Invoice',
            transaction_type_id: salesTransactionType.id,
            created_by_code: user.id,
            created_by_name: userName,
            description: `Sales Invoice ${fullInvoice.invoice_ref_number} - ${customer.full_name}`,
            account_type_code: receivableAccountType?.code || 'ASSET',
            account_type_name: receivableAccountType?.name || 'Accounts Receivable',
            account_type_id: receivableAccountType?.id,
            account_id: receivableAccount.id,
            account_name: receivableAccount.name,
            account_code: receivableAccount.code,
            account_nature: 'debit',
              exchange_rate: exchangeRate,
              amount: balanceAmountInSystemCurrency,
              system_currency_id: systemCurrency.id,
              user_debit_amount: balanceAmountInInvoiceCurrency,
              equivalent_debit_amount: balanceAmountInSystemCurrency,
            username: user.username,
            general_ledger_id: glParentId,
            companyId: companyId
          }, { transaction });

          results.generalLedger.push(arEntry);
        }
      } else {
        throw new Error('Accounts Receivable account not found. Please set default_receivable_account_id on customer or account_receivable_id on invoice');
      }

      // Sales Revenue Credit Entries - Grouped by account (per item)
      // IMPORTANT: Revenue should be based on SUBTOTAL (before tax), not total amount
      // Group revenue amounts by account to handle multiple income accounts
      const revenueByAccount = new Map(); // Map<accountId, { amount, account, accountType }>
      
      // Calculate line subtotals per item and group by income account
      // Use invoice subtotal to ensure we don't include tax in revenue
      let totalLineSubtotal = 0;
      for (const item of fullInvoice.items || []) {
        const incomeAccountId = item.product?.category?.income_account_id || item.product?.income_account_id;
        
        if (!incomeAccountId) {
          results.errors.push(`Income account not found for item ${item.id || 'unknown'}. Please set income_account_id on product category or product.`);
          continue;
        }

        if (!revenueByAccount.has(incomeAccountId)) {
          const incomeAccount = await Account.findByPk(incomeAccountId, { transaction });
          if (incomeAccount) {
            const incomeAccountType = await AccountType.findByPk(incomeAccount.account_type_id, { transaction });
            revenueByAccount.set(incomeAccountId, {
              account: incomeAccount,
              accountType: incomeAccountType,
              amount: 0
            });
          } else {
            results.errors.push(`Income account with ID ${incomeAccountId} not found for item ${item.id || 'unknown'}`);
            continue;
          }
        }

        // Calculate line subtotal (quantity * unit_price) - this is in invoice currency
        // This should match the invoice subtotal (before tax and discount)
        const lineSubtotal = parseFloat(item.quantity || 0) * parseFloat(item.unit_price || 0);
        totalLineSubtotal += lineSubtotal;
        const accountData = revenueByAccount.get(incomeAccountId);
        accountData.amount += lineSubtotal;
      }

      if (revenueByAccount.size === 0) {
        throw new Error('No income accounts found. Please set income_account_id on product category or product for at least one item.');
      }

      // Post revenue entries grouped by account
      // IMPORTANT: Use invoice subtotal (not total) to ensure revenue doesn't include tax
      // If line subtotals don't match invoice subtotal, distribute proportionally
      for (const [accountId, accountData] of revenueByAccount.entries()) {
        const incomeAccount = accountData.account;
        const incomeAccountType = accountData.accountType;
        
        // Calculate revenue amount proportionally based on invoice subtotal
        // This ensures revenue matches invoice subtotal exactly (not total)
        const revenueAmount = totalLineSubtotal > 0 && invoiceSubtotal > 0
          ? (accountData.amount / totalLineSubtotal) * invoiceSubtotal
          : accountData.amount;
        
        // Calculate equivalent amount for revenue proportionally
        // Use subtotal-based equivalent amount (not total-based) to ensure revenue matches subtotal
        const revenueAmountInSystemCurrency = invoiceSubtotal > 0 && invoiceSubtotalEquivalentAmount > 0
          ? (revenueAmount / invoiceSubtotal) * invoiceSubtotalEquivalentAmount
          : (exchangeRate > 0 ? revenueAmount * exchangeRate : revenueAmount);
        const revenueAmountInInvoiceCurrency = revenueAmount; // Already in invoice currency

        const revenueEntry = await GeneralLedger.create({
          financial_year_code: financialYear.name,
          financial_year_id: financialYear.id,
          system_date: new Date(),
          transaction_date: invoiceDate,
          reference_number: fullInvoice.invoice_ref_number,
          transaction_type: 'SALES_INVOICE',
          transaction_type_name: 'Sales Invoice',
          transaction_type_id: salesTransactionType.id,
          created_by_code: user.id,
          created_by_name: userName,
          description: `Sales Revenue (${incomeAccount.code}) - Invoice ${fullInvoice.invoice_ref_number}`,
          account_type_code: incomeAccountType?.code || 'INCOME',
          account_type_name: incomeAccountType?.name || 'Sales Revenue',
          account_type_id: incomeAccountType?.id,
          account_id: incomeAccount.id,
          account_name: incomeAccount.name,
          account_code: incomeAccount.code,
          account_nature: 'credit',
          exchange_rate: exchangeRate,
          amount: revenueAmountInSystemCurrency,
          system_currency_id: systemCurrency.id,
          user_credit_amount: revenueAmountInInvoiceCurrency,
          equivalent_credit_amount: revenueAmountInSystemCurrency,
          username: user.username,
          general_ledger_id: glParentId,
          companyId: companyId
        }, { transaction });

        results.generalLedger.push(revenueEntry);
      }

      // Discount Allowed Account Entry (if discount_amount > 0)
      const discountAmount = parseFloat(fullInvoice.discount_amount || 0);
      if (discountAmount > 0) {
        const discountAccountId = fullInvoice.discount_allowed_account_id;
        if (discountAccountId) {
          const discountAccount = await Account.findByPk(discountAccountId, { transaction });
          if (discountAccount) {
            const discountAccountType = await AccountType.findByPk(discountAccount.account_type_id, { transaction });
            // Use invoice's equivalent_amount proportionally for discount_amount
            // Calculate equivalent amount for discount_amount proportionally
            const discountAmountInSystemCurrency = totalAmount > 0 && invoiceEquivalentAmount > 0
              ? (discountAmount / totalAmount) * invoiceEquivalentAmount
              : (exchangeRate > 0 ? discountAmount * exchangeRate : discountAmount);
            const discountAmountInInvoiceCurrency = discountAmount; // Already in invoice currency

            // Discount Allowed Debit Entry (reduces revenue)
            const discountEntry = await GeneralLedger.create({
              financial_year_code: financialYear.name,
              financial_year_id: financialYear.id,
              system_date: new Date(),
              transaction_date: invoiceDate,
              reference_number: fullInvoice.invoice_ref_number,
              transaction_type: 'SALES_INVOICE',
              transaction_type_name: 'Sales Invoice',
              transaction_type_id: salesTransactionType.id,
              created_by_code: user.id,
              created_by_name: userName,
              description: `Discount Allowed - Invoice ${fullInvoice.invoice_ref_number}`,
              account_type_code: discountAccountType?.code || 'EXPENSE',
              account_type_name: discountAccountType?.name || 'Discount Allowed',
              account_type_id: discountAccountType?.id,
              account_id: discountAccount.id,
              account_name: discountAccount.name,
              account_code: discountAccount.code,
            account_nature: 'debit',
            exchange_rate: exchangeRate,
            amount: discountAmountInSystemCurrency,
            system_currency_id: systemCurrency.id,
            user_debit_amount: discountAmountInInvoiceCurrency,
            equivalent_debit_amount: discountAmountInSystemCurrency,
              username: user.username,
              general_ledger_id: glParentId,
              companyId: companyId
            }, { transaction });

            results.generalLedger.push(discountEntry);
          }
        }
      }

      // Tax Payable Credit Entries - Per Item (grouped by account)
      // IMPORTANT: Tax entries are ONLY created if items have sales_tax_id assigned
      // Product-level tax assignment is the source of truth - invoice-level tax_amount is ignored if items have no tax_id
      // Group tax amounts by account to avoid duplicate entries
      const taxByAccount = new Map(); // Map<accountId, { amount, account, accountType }>
      
      // Calculate tax amount for use in tax section
      const invoiceTaxAmount = parseFloat(fullInvoice.tax_amount || 0);
      
      // Track total item tax to detect data integrity issues
      let totalItemTax = 0;
      let itemsWithTaxButNoId = 0;
      
      for (const item of fullInvoice.items || []) {
        const itemTaxAmount = parseFloat(item.tax_amount || 0);
        totalItemTax += itemTaxAmount;
        
        // CRITICAL: Only create tax entry if BOTH conditions are met:
        // 1. itemTaxAmount > 0 (item has tax amount)
        // 2. item.sales_tax_id exists (tax code is assigned to item)
        // If tax_id is missing, NO tax entry is created (even if tax_amount > 0)
        if (itemTaxAmount > 0 && item.sales_tax_id) {
          // Get TaxCode for this item
          const taxCode = item.salesTaxCode || await TaxCode.findByPk(item.sales_tax_id, { transaction });
          
          if (taxCode && taxCode.sales_tax_account_id) {
            const accountId = taxCode.sales_tax_account_id;
            
            if (!taxByAccount.has(accountId)) {
              const taxAccount = await Account.findByPk(accountId, { transaction });
              if (taxAccount) {
                const taxAccountType = await AccountType.findByPk(taxAccount.account_type_id, { transaction });
                taxByAccount.set(accountId, {
                  account: taxAccount,
                  accountType: taxAccountType,
                  amount: 0
                });
              } else {
                results.errors.push(`Tax Account: Account ${accountId} not found for tax code ${taxCode.code}`);
                continue;
              }
            }
            
            // Add this item's tax amount to the account total
            const accountData = taxByAccount.get(accountId);
            accountData.amount += itemTaxAmount;
          } else if (taxCode && !taxCode.sales_tax_account_id) {
            results.errors.push(`Tax Account: Tax code ${taxCode.code} does not have a sales tax account configured`);
          } else {
            results.errors.push(`Tax Account: Tax code not found for item ${item.id}`);
          }
        } else if (itemTaxAmount > 0 && !item.sales_tax_id) {
          // Item has tax amount but no tax_id - this is a data integrity issue
          // NO tax entry will be created - product-level tax_id is the source of truth
          itemsWithTaxButNoId++;
        }
      }
      
      // Data integrity check: Warn if invoice has tax but items don't have tax_id
      // This indicates the invoice.tax_amount was incorrectly calculated/stored
      // But we do NOT create a tax entry - items without tax_id mean NO tax should be posted
      if (invoiceTaxAmount > 0 && taxByAccount.size === 0) {
        if (itemsWithTaxButNoId > 0) {
          results.errors.push(`Tax Account: Invoice has tax_amount (${invoiceTaxAmount.toFixed(2)}) but items have no sales_tax_id assigned. No tax entry created - product-level tax assignment is required.`);
        } else if (totalItemTax === 0) {
          results.errors.push(`Tax Account: Invoice has tax_amount (${invoiceTaxAmount.toFixed(2)}) but items have no tax amounts. This is a data integrity issue - invoice tax_amount should be 0.`);
        }
      } else if (invoiceTaxAmount > 0 && Math.abs(invoiceTaxAmount - totalItemTax) > 0.01) {
        // Invoice tax doesn't match sum of item taxes - this is a data integrity issue
        results.errors.push(`Tax Account: Invoice tax (${invoiceTaxAmount.toFixed(2)}) doesn't match sum of item taxes (${totalItemTax.toFixed(2)}). Difference: ${(invoiceTaxAmount - totalItemTax).toFixed(2)}`);
      }
      
      // Post tax entries grouped by account
      for (const [accountId, accountData] of taxByAccount.entries()) {
        const taxAmount = accountData.amount;
        const taxAccount = accountData.account;
        const taxAccountType = accountData.accountType;
        
        // Calculate equivalent amount for tax_amount proportionally
        const taxAmountInSystemCurrency = totalAmount > 0 && invoiceEquivalentAmount > 0
          ? (taxAmount / totalAmount) * invoiceEquivalentAmount
          : (exchangeRate > 0 ? taxAmount * exchangeRate : taxAmount);
        const taxAmountInInvoiceCurrency = taxAmount; // Already in invoice currency

        const taxEntry = await GeneralLedger.create({
          financial_year_code: financialYear.name,
          financial_year_id: financialYear.id,
          system_date: new Date(),
          transaction_date: invoiceDate,
          reference_number: fullInvoice.invoice_ref_number,
          transaction_type: 'SALES_INVOICE',
          transaction_type_name: 'Sales Invoice',
          transaction_type_id: salesTransactionType.id,
          created_by_code: user.id,
          created_by_name: userName,
          description: `Tax Payable (${taxAccount.code}) - Invoice ${fullInvoice.invoice_ref_number}`,
          account_type_code: taxAccountType?.code || 'LIABILITY',
          account_type_name: taxAccountType?.name || 'Tax Payable',
          account_type_id: taxAccountType?.id,
          account_id: taxAccount.id,
          account_name: taxAccount.name,
          account_code: taxAccount.code,
          account_nature: 'credit',
          exchange_rate: exchangeRate,
          amount: taxAmountInSystemCurrency,
          system_currency_id: systemCurrency.id,
          user_credit_amount: taxAmountInInvoiceCurrency,
          equivalent_credit_amount: taxAmountInSystemCurrency,
          username: user.username,
          general_ledger_id: glParentId,
          companyId: companyId
        }, { transaction });

        results.generalLedger.push(taxEntry);
      }

      // WHT Receivable Debit Entries - Per Item (grouped by account)
      // Group WHT amounts by account to avoid duplicate entries
      const whtByAccount = new Map(); // Map<accountId, { amount, account, accountType }>
      
      for (const item of fullInvoice.items || []) {
        const itemWhtAmount = parseFloat(item.wht_amount || 0);
        if (itemWhtAmount > 0 && item.wht_tax_id) {
          // Get TaxCode for this item's WHT
          const whtTaxCode = item.whtTaxCode || await TaxCode.findByPk(item.wht_tax_id, { transaction });
          
          if (whtTaxCode && whtTaxCode.sales_tax_account_id) {
            // For WHT, use sales_tax_account_id from the TaxCode (since it's a sales invoice)
            const accountId = whtTaxCode.sales_tax_account_id;
            
            if (!whtByAccount.has(accountId)) {
              const whtAccount = await Account.findByPk(accountId, { transaction });
              if (whtAccount) {
                const whtAccountType = await AccountType.findByPk(whtAccount.account_type_id, { transaction });
                whtByAccount.set(accountId, {
                  account: whtAccount,
                  accountType: whtAccountType,
                  amount: 0
                });
              } else {
                results.errors.push(`WHT Account: Account ${accountId} not found for WHT tax code ${whtTaxCode.code}`);
                continue;
              }
            }
            
            // Add this item's WHT amount to the account total
            const accountData = whtByAccount.get(accountId);
            accountData.amount += itemWhtAmount;
          } else if (whtTaxCode && !whtTaxCode.sales_tax_account_id) {
            results.errors.push(`WHT Account: WHT tax code ${whtTaxCode.code} does not have a sales tax account configured`);
          } else {
            results.errors.push(`WHT Account: WHT tax code not found for item ${item.id}`);
          }
        }
      }
      
      // Post WHT entries grouped by account
      for (const [accountId, accountData] of whtByAccount.entries()) {
        const whtAmount = accountData.amount;
        const whtAccount = accountData.account;
        const whtAccountType = accountData.accountType;
        
        // Calculate equivalent amount for wht_amount proportionally
        const whtAmountInSystemCurrency = totalAmount > 0 && invoiceEquivalentAmount > 0
          ? (whtAmount / totalAmount) * invoiceEquivalentAmount
          : (exchangeRate > 0 ? whtAmount * exchangeRate : whtAmount);
        const whtAmountInInvoiceCurrency = whtAmount; // Already in invoice currency

        const whtEntry = await GeneralLedger.create({
          financial_year_code: financialYear.name,
          financial_year_id: financialYear.id,
          system_date: new Date(),
          transaction_date: invoiceDate,
          reference_number: fullInvoice.invoice_ref_number,
          transaction_type: 'SALES_INVOICE',
          transaction_type_name: 'Sales Invoice',
          transaction_type_id: salesTransactionType.id,
          created_by_code: user.id,
          created_by_name: userName,
          description: `WHT Receivable (${whtAccount.code}) - Invoice ${fullInvoice.invoice_ref_number}`,
          account_type_code: whtAccountType?.code || 'ASSET',
          account_type_name: whtAccountType?.name || 'WHT Receivable',
          account_type_id: whtAccountType?.id,
          account_id: whtAccount.id,
          account_name: whtAccount.name,
          account_code: whtAccount.code,
          account_nature: 'debit',
          exchange_rate: exchangeRate,
          amount: whtAmountInSystemCurrency,
          system_currency_id: systemCurrency.id,
          user_debit_amount: whtAmountInInvoiceCurrency,
          equivalent_debit_amount: whtAmountInSystemCurrency,
          username: user.username,
          general_ledger_id: glParentId,
          companyId: companyId
        }, { transaction });

        results.generalLedger.push(whtEntry);
      }
    } catch (error) {
      results.errors.push(`General Ledger: ${error.message}`);
      const criticalErrors = ['not found', 'required', 'Accounts Receivable', 'Income account'];
      if (criticalErrors.some(msg => error.message.includes(msg))) {
        throw new Error(`Critical General Ledger error: ${error.message}`);
      }
    }

    // ============================================
    // 2. UPDATE CUSTOMER BALANCES
    // ============================================
    try {
      const balanceAmount = parseFloat(fullInvoice.balance_amount || fullInvoice.total_amount || 0);
      
      if (balanceAmount > 0 && customer) {
        await Customer.increment('debt_balance', {
          by: balanceAmount,
          where: buildCompanyWhere(req, { id: customer.id }),
          transaction
        });

        await Customer.increment('account_balance', {
          by: balanceAmount,
          where: buildCompanyWhere(req, { id: customer.id }),
          transaction
        });

        results.customerUpdated = true;
      }
    } catch (error) {
      results.errors.push(`Customer Update: ${error.message}`);
    }

    // ============================================
    // 3. LOYALTY TRANSACTIONS
    // ============================================
    try {
      // Check if loyalty_card_configs table exists (required for loyalty transactions)
      const [loyaltyConfigTableCheck] = await sequelize.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'loyalty_card_configs'
        );
      `, { type: sequelize.QueryTypes.SELECT });
      
      const loyaltyConfigTableExists = loyaltyConfigTableCheck?.exists || false;
      
      // Check if loyalty_cards table exists (optional - for tracking individual cards)
      const [loyaltyCardsTableCheck] = await sequelize.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'loyalty_cards'
        );
      `, { type: sequelize.QueryTypes.SELECT });
      
      const loyaltyCardsTableExists = loyaltyCardsTableCheck?.exists || false;
      
      if (!loyaltyConfigTableExists) {
        results.errors.push('Loyalty Transaction: loyalty_card_configs table does not exist');
      } else if (customer?.loyalty_card_number && customer?.loyalty_card_config_id) {
        // Use savepoint to allow rollback of this section without aborting entire transaction
        await sequelize.query('SAVEPOINT loyalty_transaction', { transaction });
        
        try {
          const loyaltyConfig = await LoyaltyCardConfig.findByPk(customer.loyalty_card_config_id, { transaction });
          
          if (loyaltyConfig) {
            // Check if loyalty points can be earned for this invoice type (cash vs credit)
            // If invoice is "paid", it's a cash sale; otherwise, it's a credit sale
            const isCashSale = fullInvoice.status === 'paid';
            const isCreditSale = !isCashSale;
            
            // Check if loyalty config allows earning points for this sale type
            if (isCashSale && !loyaltyConfig.allow_gaining_cash_sales) {
              results.errors.push('Loyalty Transaction: Cash sales not allowed for earning points');
              await sequelize.query('RELEASE SAVEPOINT loyalty_transaction', { transaction });
            } else if (isCreditSale && !loyaltyConfig.allow_gaining_credit_sales) {
              results.errors.push('Loyalty Transaction: Credit sales not allowed for earning points');
              await sequelize.query('RELEASE SAVEPOINT loyalty_transaction', { transaction });
            } else {
            let loyaltyCardId = null;
            
            // Only try to find/create loyalty card if the table exists
            let isNewLoyaltyCard = false;
            if (loyaltyCardsTableExists) {
              // Find or create loyalty card
              let loyaltyCard = await LoyaltyCard.findOne({
                where: buildCompanyWhere(req, { card_number: customer.loyalty_card_number }),
                transaction
              });

              if (!loyaltyCard) {
                isNewLoyaltyCard = true;
                loyaltyCard = await LoyaltyCard.create({
                  card_number: customer.loyalty_card_number,
                  loyalty_config_id: customer.loyalty_card_config_id,
                  customer_name: customer.full_name,
                  customer_email: customer.email,
                  customer_phone: customer.phone_number,
                  current_points: 0,
                  total_points_earned: 0,
                  total_points_redeemed: 0,
                  tier_level: 'bronze',
                  tier_points_threshold: 0,
                  is_active: true,
                  issued_date: new Date(),
                  companyId: companyId,
                  created_by: user.id
                }, { transaction });
              }
              
              loyaltyCardId = loyaltyCard.id;
            }

            // ============================================
            // WELCOME BONUS POINTS (for new loyalty cards)
            // ============================================
            if (isNewLoyaltyCard && loyaltyConfig.welcome_bonus_points > 0) {
              const welcomeBonusPoints = parseInt(loyaltyConfig.welcome_bonus_points || 0);
              
              if (welcomeBonusPoints > 0) {
                // Get current customer loyalty points (before update)
                const currentCustomerPoints = parseInt(customer.loyalty_points || 0);
                const pointsBalanceBefore = currentCustomerPoints;
                const pointsBalanceAfter = pointsBalanceBefore + welcomeBonusPoints;

                // Get tier information
                let tierBefore = 'bronze';
                let tierAfter = 'bronze';
                
                if (loyaltyCardsTableExists && loyaltyCardId) {
                  const loyaltyCard = await LoyaltyCard.findByPk(loyaltyCardId, { transaction });
                  if (loyaltyCard) {
                    tierBefore = loyaltyCard.tier_level || 'bronze';
                    tierAfter = tierBefore; // Tier doesn't change with welcome bonus
                  }
                }

                // Create welcome bonus transaction
                const welcomeBonusTransaction = await LoyaltyTransaction.create({
                  loyalty_card_id: loyaltyCardId, // null if loyalty_cards table doesn't exist
                  transaction_type: 'bonus',
                  points_amount: welcomeBonusPoints,
                  transaction_reference: fullInvoice.invoice_ref_number,
                  description: `Welcome bonus points for new loyalty card`,
                  sales_invoice_id: fullInvoice.id,
                  customer_id: customer.id,
                  store_id: fullInvoice.store_id,
                  loyalty_config_id: customer.loyalty_card_config_id,
                  financial_year_id: financialYear.id,
                  transaction_ref_number: `LT-WELCOME-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  amount: 0, // Welcome bonus has no monetary amount
                  currency_id: fullInvoice.currency_id,
                  exchange_rate: 1,
                  status: 'completed',
                  notes: `Welcome bonus: ${welcomeBonusPoints} points awarded for new loyalty card`,
                  points_balance_before: pointsBalanceBefore,
                  points_balance_after: pointsBalanceAfter,
                  tier_before: tierBefore,
                  tier_after: tierAfter,
                  transaction_date: invoiceDate,
                  expiry_date: null, // TODO: Calculate expiry date based on loyalty config rules
                  is_expired: false,
                  companyId: companyId,
                  created_by: user.id,
                  updated_by: user.id
                }, { transaction });

                // Update loyalty card points (only if loyalty_cards table exists)
                if (loyaltyCardsTableExists && loyaltyCardId) {
                  await LoyaltyCard.increment('current_points', {
                    by: welcomeBonusPoints,
                    where: { id: loyaltyCardId },
                    transaction
                  });

                  await LoyaltyCard.increment('total_points_earned', {
                    by: welcomeBonusPoints,
                    where: { id: loyaltyCardId },
                    transaction
                  });
                }

                // Update customer loyalty points
                await Customer.increment('loyalty_points', {
                  by: welcomeBonusPoints,
                  where: buildCompanyWhere(req, { id: customer.id }),
                  transaction
                });

                // Update customer object for subsequent calculations
                customer.loyalty_points = pointsBalanceAfter;
              }
            }

            // ============================================
            // BIRTHDAY BONUS POINTS
            // ============================================
            if (loyaltyConfig.birthday_bonus_points > 0 && customer.birthday) {
              const birthdayBonusPoints = parseInt(loyaltyConfig.birthday_bonus_points || 0);
              
              if (birthdayBonusPoints > 0) {
                // Parse customer birthday
                const customerBirthday = new Date(customer.birthday);
                const today = new Date(invoiceDate);
                
                // Check if today matches customer's birthday (month and day)
                const isBirthdayToday = 
                  customerBirthday.getMonth() === today.getMonth() &&
                  customerBirthday.getDate() === today.getDate();

                if (isBirthdayToday) {
                  // Check if birthday bonus was already awarded this year
                  const currentYear = today.getFullYear();
                  const yearStart = new Date(currentYear, 0, 1);
                  const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

                  const existingBirthdayBonus = await LoyaltyTransaction.findOne({
                    where: {
                      customer_id: customer.id,
                      transaction_type: 'bonus',
                      description: {
                        [Op.like]: '%birthday%'
                      },
                      transaction_date: {
                        [Op.between]: [yearStart, yearEnd]
                      },
                      companyId: companyId
                    },
                    transaction
                  });

                  // Only award if not already awarded this year
                  if (!existingBirthdayBonus) {
                    // Get current customer loyalty points (before update)
                    const currentCustomerPoints = parseInt(customer.loyalty_points || 0);
                    const pointsBalanceBefore = currentCustomerPoints;
                    const pointsBalanceAfter = pointsBalanceBefore + birthdayBonusPoints;

                    // Get tier information
                    let tierBefore = 'bronze';
                    let tierAfter = 'bronze';
                    
                    if (loyaltyCardsTableExists && loyaltyCardId) {
                      const loyaltyCard = await LoyaltyCard.findByPk(loyaltyCardId, { transaction });
                      if (loyaltyCard) {
                        tierBefore = loyaltyCard.tier_level || 'bronze';
                        tierAfter = tierBefore; // Tier doesn't change with birthday bonus
                      }
                    }

                    // Create birthday bonus transaction
                    const birthdayBonusTransaction = await LoyaltyTransaction.create({
                      loyalty_card_id: loyaltyCardId, // null if loyalty_cards table doesn't exist
                      transaction_type: 'bonus',
                      points_amount: birthdayBonusPoints,
                      transaction_reference: fullInvoice.invoice_ref_number,
                      description: `Birthday bonus points`,
                      sales_invoice_id: fullInvoice.id,
                      customer_id: customer.id,
                      store_id: fullInvoice.store_id,
                      loyalty_config_id: customer.loyalty_card_config_id,
                      financial_year_id: financialYear.id,
                      transaction_ref_number: `LT-BIRTHDAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      amount: 0, // Birthday bonus has no monetary amount
                      currency_id: fullInvoice.currency_id,
                      exchange_rate: 1,
                      status: 'completed',
                      notes: `Birthday bonus: ${birthdayBonusPoints} points awarded on customer's birthday`,
                      points_balance_before: pointsBalanceBefore,
                      points_balance_after: pointsBalanceAfter,
                      tier_before: tierBefore,
                      tier_after: tierAfter,
                      transaction_date: invoiceDate,
                      expiry_date: null, // TODO: Calculate expiry date based on loyalty config rules
                      is_expired: false,
                      companyId: companyId,
                      created_by: user.id,
                      updated_by: user.id
                    }, { transaction });

                    // Update loyalty card points (only if loyalty_cards table exists)
                    if (loyaltyCardsTableExists && loyaltyCardId) {
                      await LoyaltyCard.increment('current_points', {
                        by: birthdayBonusPoints,
                        where: { id: loyaltyCardId },
                        transaction
                      });

                      await LoyaltyCard.increment('total_points_earned', {
                        by: birthdayBonusPoints,
                        where: { id: loyaltyCardId },
                        transaction
                      });
                    }

                    // Update customer loyalty points
                    await Customer.increment('loyalty_points', {
                      by: birthdayBonusPoints,
                      where: buildCompanyWhere(req, { id: customer.id }),
                      transaction
                    });

                    // Update customer object for subsequent calculations
                    customer.loyalty_points = pointsBalanceAfter;
                  }
                }
              }
            }

            // Calculate points earned (based on config rules)
            // invoiceAmount is in invoice currency (could be USD, TZS, etc.)
            const invoiceAmount = parseFloat(fullInvoice.subtotal || 0);
            
            // Convert invoice amount to system currency for both limit checks AND points calculation
            // exchangeRate converts FROM invoice currency TO system currency
            // So: systemCurrencyAmount = invoiceAmount × exchangeRate
            const invoiceAmountInSystemCurrency = exchangeRate > 0 ? invoiceAmount * exchangeRate : invoiceAmount;
            
            let pointsEarned = 0;

            // Check if invoice amount (in system currency) is within gain rate limits
            // Limits are typically set in system currency (TZS)
            const lowerLimit = parseFloat(loyaltyConfig.gain_rate_lower_limit || 0);
            const upperLimit = parseFloat(loyaltyConfig.gain_rate_upper_limit || 999999999);
            
            // Compare using system currency amount
            if (invoiceAmountInSystemCurrency >= lowerLimit && invoiceAmountInSystemCurrency <= upperLimit) {
              const gainRateType = loyaltyConfig.gain_rate_type || 'percentage';
              const gainRateValue = parseFloat(loyaltyConfig.gain_rate_value || 0);
              
              if (gainRateType === 'percentage') {
                // Percentage: Calculate points based on SYSTEM CURRENCY amount
                // This ensures fairness - same purchasing power = same points regardless of invoice currency
                // Points = invoiceAmountInSystemCurrency × (gain_rate_value / 100)
                pointsEarned = Math.floor(invoiceAmountInSystemCurrency * (gainRateValue / 100));
              } else if (gainRateType === 'fixed') {
                // Fixed: points = gain_rate_value per transaction (regardless of amount)
                pointsEarned = Math.floor(gainRateValue);
              }
              
              // Legacy support: check old fields if new fields don't produce points
              if (pointsEarned === 0) {
                if (loyaltyConfig.points_per_currency_unit) {
                  // Legacy: points per currency unit (use system currency for consistency)
                  pointsEarned = Math.floor(invoiceAmountInSystemCurrency * parseFloat(loyaltyConfig.points_per_currency_unit));
                } else if (loyaltyConfig.points_percentage) {
                  // Legacy: points percentage (use system currency for consistency)
                  pointsEarned = Math.floor(invoiceAmountInSystemCurrency * (parseFloat(loyaltyConfig.points_percentage) / 100));
                }
              }
            }

            if (pointsEarned > 0) {
              // Get current customer loyalty points (before update)
              const currentCustomerPoints = parseInt(customer.loyalty_points || 0);
              const pointsBalanceBefore = currentCustomerPoints;
              const pointsBalanceAfter = pointsBalanceBefore + pointsEarned;

              // Get tier information (from loyalty card if exists, otherwise default to bronze)
              let tierBefore = 'bronze';
              let tierAfter = 'bronze';
              
              if (loyaltyCardsTableExists && loyaltyCardId) {
                const loyaltyCard = await LoyaltyCard.findByPk(loyaltyCardId, { transaction });
                if (loyaltyCard) {
                  tierBefore = loyaltyCard.tier_level || 'bronze';
                  // Tier after would be calculated based on total points, but for now keep same tier
                  // TODO: Implement tier upgrade logic based on loyalty config thresholds
                  tierAfter = tierBefore;
                }
              }

              // Create loyalty transaction (loyalty_card_id can be null if loyalty_cards table doesn't exist)
              const loyaltyTransaction = await LoyaltyTransaction.create({
                loyalty_card_id: loyaltyCardId, // null if loyalty_cards table doesn't exist
                transaction_type: 'earn',
                points_amount: pointsEarned,
                transaction_reference: fullInvoice.invoice_ref_number,
                description: `Points earned from Sales Invoice ${fullInvoice.invoice_ref_number}`,
                sales_invoice_id: fullInvoice.id,
                customer_id: customer.id,
                store_id: fullInvoice.store_id,
                loyalty_config_id: customer.loyalty_card_config_id,
                financial_year_id: financialYear.id,
                transaction_ref_number: `LT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                amount: invoiceAmount,
                currency_id: fullInvoice.currency_id,
                exchange_rate: exchangeRate,
                status: 'completed',
                notes: `Earned ${pointsEarned} points from invoice ${fullInvoice.invoice_ref_number}`,
                points_balance_before: pointsBalanceBefore,
                points_balance_after: pointsBalanceAfter,
                tier_before: tierBefore,
                tier_after: tierAfter,
                transaction_date: invoiceDate,
                expiry_date: null, // TODO: Calculate expiry date based on loyalty config rules
                is_expired: false,
                companyId: companyId,
                created_by: user.id,
                updated_by: user.id
              }, { transaction });

              // Update loyalty card points (only if loyalty_cards table exists)
              if (loyaltyCardsTableExists && loyaltyCardId) {
                await LoyaltyCard.increment('current_points', {
                  by: pointsEarned,
                  where: { id: loyaltyCardId },
                  transaction
                });

                await LoyaltyCard.increment('total_points_earned', {
                  by: pointsEarned,
                  where: { id: loyaltyCardId },
                  transaction
                });
              }

              // Update customer loyalty points
              await Customer.increment('loyalty_points', {
                by: pointsEarned,
                where: buildCompanyWhere(req, { id: customer.id }),
                transaction
              });

              results.loyaltyTransaction = loyaltyTransaction;
            }
            }
          }
          try {
            await sequelize.query('RELEASE SAVEPOINT loyalty_transaction', { transaction });
          } catch (releaseError) {
            // Savepoint may have already been released, ignore
          }
        } catch (innerError) {
          try {
            await sequelize.query('ROLLBACK TO SAVEPOINT loyalty_transaction', { transaction });
          } catch (rollbackError) {
            // If rollback fails, the transaction is already aborted
          }
          results.errors.push(`Loyalty Transaction: ${innerError.message}`);
        }
      }
    } catch (error) {
      results.errors.push(`Loyalty Transaction: ${error.message}`);
    }

    // ============================================
    // 4. PRICE HISTORY
    // ============================================
    try {
      for (const item of fullInvoice.items || []) {
        const product = item.product;
        const oldPrice = parseFloat(product?.selling_price || 0);
        const newPrice = parseFloat(item.unit_price || 0);

        // Only log if price changed
        if (oldPrice !== newPrice && newPrice > 0) {
          const priceHistory = await PriceHistory.create({
            entity_type: 'product',
            entity_id: product.id,
            entity_code: product.code,
            entity_name: product.name,
            module_name: 'Sales Invoice',
            transaction_type_id: salesTransactionType.id,
            transaction_type_name: 'Sales Invoice',
            old_selling_price: oldPrice,
            new_selling_price: newPrice,
            quantity: parseFloat(item.quantity || 0),
            unit: product.unit || 'pcs',
            currency_id: fullInvoice.currency_id,
            exchange_rate: exchangeRate,
            reference_number: fullInvoice.invoice_ref_number,
            description: `Price change from Sales Invoice ${fullInvoice.invoice_ref_number}`,
            companyId: companyId,
            created_by: user.id
          }, { transaction });

          results.priceHistory.push(priceHistory);
        }
      }
    } catch (error) {
      results.errors.push(`Price History: ${error.message}`);
    }

    // ============================================
    // 5. PRODUCT EXPIRY (Batch Numbers)
    // ============================================
    try {
      for (const item of fullInvoice.items || []) {
        // Skip stock tracking for services products
        const product = item.product;
        const productType = product?.product_type;
        if (productType === 'services') {
          continue; // Skip services products - they don't have stock
        }
        
        if (item.batch_number && item.expiry_date) {
          const batchNumber = item.batch_number.trim();
          
          // Parse expiry date consistently (same as validation) - use UTC to avoid timezone shifts
          let expiryDate;
          if (typeof item.expiry_date === 'string') {
            // Parse as UTC date to avoid timezone issues
            const dateStr = item.expiry_date.split('T')[0]; // Get YYYY-MM-DD part
            const [year, month, day] = dateStr.split('-').map(Number);
            expiryDate = new Date(Date.UTC(year, month - 1, day));
          } else {
            // If it's a Date object, create a new UTC date from its components
            const date = new Date(item.expiry_date);
            expiryDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
          }
          
          const quantity = parseFloat(item.quantity || 0);

          if (quantity > 0) {
            // Find by batch number only (expiry date already validated in validation section)
            const productExpiry = await ProductExpiryDate.findOne({
              where: buildCompanyWhere(req, {
                product_id: item.product_id,
                store_id: fullInvoice.store_id,
                batch_number: batchNumber
              }),
              transaction
            });

            if (productExpiry) {
              const currentQuantity = parseFloat(productExpiry.current_quantity || 0);
              // Validation already done above, but double-check
              if (currentQuantity < quantity) {
                throw new Error(`Insufficient batch quantity for "${batchNumber}". Available: ${currentQuantity}, Required: ${quantity}`);
              }
              
              const newQuantity = currentQuantity - quantity;
              
              await productExpiry.update({
                current_quantity: newQuantity,
                total_quantity_sold: parseFloat(productExpiry.total_quantity_sold || 0) + quantity,
                status: newQuantity === 0 ? 'sold' : productExpiry.status || 'active',
                last_updated: new Date()
              }, { transaction });

              results.productExpiry.push(productExpiry);
            } else {
              results.errors.push(`Product Expiry: Batch "${batchNumber}" not found`);
            }
          }
        }
      }
    } catch (error) {
      results.errors.push(`Product Expiry: ${error.message}`);
    }

    // ============================================
    // 6. PRODUCT SERIAL NUMBERS
    // ============================================
    try {
      for (const item of fullInvoice.items || []) {
        // Skip stock tracking for services products
        const product = item.product;
        const productType = product?.product_type;
        if (productType === 'services') {
          continue; // Skip services products - they don't have stock
        }
        
        if (item.serial_numbers && Array.isArray(item.serial_numbers) && item.serial_numbers.length > 0) {
          for (const serialNumber of item.serial_numbers) {
            const serial = String(serialNumber).trim();
            
            if (serial) {
              const productSerial = await ProductSerialNumber.findOne({
                where: buildCompanyWhere(req, {
                  product_id: item.product_id,
                  store_id: fullInvoice.store_id,
                  serial_number: serial
                }),
                transaction
              });

              if (productSerial) {
                const currentQuantity = parseFloat(productSerial.current_quantity || 0);
                // Validation already done above, but double-check
                if (currentQuantity < 1) {
                  throw new Error(`Serial number "${serial}" has insufficient quantity. Available: ${currentQuantity}, Required: 1`);
                }
                
                const newQuantity = currentQuantity - 1;
                
                await productSerial.update({
                  current_quantity: newQuantity,
                  total_quantity_sold: parseFloat(productSerial.total_quantity_sold || 0) + 1,
                  status: newQuantity === 0 ? 'sold' : 'active', // Mark as sold only when quantity reaches 0, otherwise keep active
                  last_updated: new Date()
                }, { transaction });

                results.productSerial.push(productSerial);
              } else {
                results.errors.push(`Product Serial: Serial "${serial}" not found`);
              }
            }
          }
        }
      }
    } catch (error) {
      results.errors.push(`Product Serial: ${error.message}`);
    }

    // ============================================
    // 7. PRODUCT TRANSACTIONS
    // ============================================
    try {
      for (const item of fullInvoice.items || []) {
        const product = item.product;
        // Skip stock tracking for services products
        const productType = product?.product_type;
        if (productType === 'services') {
          continue; // Skip services products - they don't have stock transactions
        }
        
        const quantity = parseFloat(item.quantity || 0);
        const unitPrice = parseFloat(item.unit_price || 0);
        const lineTotal = quantity * unitPrice;
        const averageCost = parseFloat(product?.average_cost || 0);

        // Get transaction type for sales (reuse cached version)
        const salesType = await getSalesTransactionType();

        const productTransaction = await ProductTransactionService.logTransaction({
          transaction_type_id: salesType.id,
          transaction_type_name: 'Sales Invoice',
          transaction_date: invoiceDate,
          financial_year_id: financialYear.id,
          financial_year_name: financialYear.name,
          store_id: fullInvoice.store_id,
          product_id: item.product_id,
          product_type: product?.product_type || null,
          manufacturer_id: product?.manufacturer_id,
          model_id: product?.model_id,
          brand_name_id: product?.brand_id,
          packaging_id: product?.default_packaging_id,
          packaging_issue_quantity: quantity,
          supplier_id: null,
          customer_id: customer?.id,
          customer_name: customer?.full_name,
          created_by_id: user.id,
          updated_by_id: user.id,
          reference_number: fullInvoice.invoice_ref_number,
          notes: `Sales Invoice ${fullInvoice.invoice_ref_number} - ${customer?.full_name || ''}`,
          exchange_rate: exchangeRate,
          currency_id: fullInvoice.currency_id,
          quantity_in: 0,
          quantity_out: quantity,
          user_unit_cost: unitPrice,
          product_average_cost: averageCost,
          serial_number: item.serial_numbers?.[0] || null,
          expiry_date: item.expiry_date ? new Date(item.expiry_date) : null,
          reference_type: 'SALES_INVOICE',
          companyId: companyId
        }, transaction);

        results.productTransactions.push(productTransaction);
      }
    } catch (error) {
      results.errors.push(`Product Transactions: ${error.message}`);
    }

    // ============================================
    // 8. PRODUCT STORE QUANTITY UPDATE
    // ============================================
    try {
      for (const item of fullInvoice.items || []) {
        const product = item.product;
        // Skip stock tracking for services products
        const productType = product?.product_type;
        if (productType === 'services') {
          continue; // Skip services products - they don't have stock
        }
        
        const quantity = parseFloat(item.quantity || 0);
        
        // Find ProductStore record WITH ROW LOCK to prevent race conditions
        const productStore = await ProductStore.findOne({
          where: buildCompanyWhere(req, {
            product_id: item.product_id,
            store_id: fullInvoice.store_id
          }),
          lock: transaction.LOCK.UPDATE, // Lock the row to prevent concurrent updates
          transaction
        });

        if (productStore) {
          const currentQuantity = parseFloat(productStore.quantity || 0);
          // Validation already done above, but double-check with locked quantity
          if (currentQuantity < quantity) {
            throw new Error(`Insufficient stock for product "${product?.name || item.product_id}". Available: ${currentQuantity}, Required: ${quantity}`);
          }
          
          // Use decrement to avoid race conditions (atomic operation)
          await productStore.decrement('quantity', { by: quantity, transaction });
          await productStore.update({
            last_updated: new Date()
          }, { transaction });
        } else {
          throw new Error(`Product "${product?.name || item.product_id}" not found in store inventory`);
        }
      }
    } catch (error) {
      results.errors.push(`ProductStore: ${error.message}`);
      throw error;
    }

    // ============================================
    // 9. SALES TRANSACTION CREATE/UPDATE
    // ============================================
    try {
      let salesTransaction = await SalesTransaction.findOne({
        where: buildCompanyWhere(req, { source_invoice_id: fullInvoice.id }),
        transaction
      });

      if (salesTransaction) {
        // Update existing sales transaction
        await salesTransaction.update({
          status: 'approved',
          approved_by: user.id,
          approved_at: new Date(),
          updated_by: user.id
        }, { transaction });

        results.salesTransaction = salesTransaction;
      } else {
        const { createTransactionFromInvoice } = require('./salesTransactionHelper');
        try {
          salesTransaction = await createTransactionFromInvoice(fullInvoice, req, { transaction });
          
          await salesTransaction.update({
            status: 'approved',
            approved_by: user.id,
            approved_at: new Date(),
            updated_by: user.id
          }, { transaction });

          results.salesTransaction = salesTransaction;
        } catch (createError) {
          results.errors.push(`Sales Transaction: Failed to create - ${createError.message}`);
        }
      }
    } catch (error) {
      results.errors.push(`Sales Transaction: ${error.message}`);
    }

    return results;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  approveSalesInvoice
};

