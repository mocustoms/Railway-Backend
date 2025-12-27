const { PhysicalInventory, PhysicalInventoryItem, Store, AdjustmentReason, Product, User, Currency, Account } = require('../models');
const { Op } = require('sequelize');

class PhysicalInventoryService {
  /**
   * Clean numeric string to remove multiple decimal points and invalid characters
   * Converts values like "1.0032.5" to "1.00325"
   */
  static cleanNumericString(value) {
    if (value === null || value === undefined || value === '') {
      return '0';
    }
    
    // Convert to string and remove all non-numeric characters except first decimal point and minus sign
    let cleaned = String(value).replace(/[^0-9.-]/g, '');
    
    // Handle negative sign - ensure it's only at the start
    const isNegative = cleaned.startsWith('-');
    cleaned = cleaned.replace(/-/g, '');
    if (isNegative) {
      cleaned = '-' + cleaned;
    }
    
    // Handle multiple decimal points by keeping only the first one
    if (cleaned.includes('.')) {
      const firstDotIndex = cleaned.indexOf('.');
      const beforeDot = cleaned.substring(0, firstDotIndex + 1);
      const afterDot = cleaned.substring(firstDotIndex + 1).replace(/\./g, '');
      cleaned = beforeDot + afterDot;
    }
    
    // If empty after cleaning, return '0'
    if (cleaned === '' || cleaned === '-') {
      return '0';
    }
    
    return cleaned;
  }

  /**
   * Safely parse numeric value, handling malformed strings
   */
  static safeParseFloat(value, defaultValue = 0) {
    try {
      const cleaned = this.cleanNumericString(value);
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? defaultValue : parsed;
    } catch (error) {
      return defaultValue;
    }
  }

  /**
   * Safely get exchange rate from physical inventory object
   * Handles cases where exchange_rate might be a malformed string from database
   * Similar to Stock Adjustment's pattern: stockAdjustment.exchange_rate || 1
   */
  static getSafeExchangeRate(physicalInventory, defaultValue = 1.0) {
    if (!physicalInventory || physicalInventory.exchange_rate === null || physicalInventory.exchange_rate === undefined) {
      return defaultValue;
    }
    
    // Clean and parse the exchange rate
    const cleaned = this.cleanNumericString(physicalInventory.exchange_rate);
    const parsed = parseFloat(cleaned);
    
    // Return parsed value or default, ensuring it's a proper number
    const result = isNaN(parsed) || parsed <= 0 ? defaultValue : Number(parsed);
    
    // Final validation - ensure result is a valid finite number
    if (!isFinite(result) || isNaN(result)) {
      return defaultValue;
    }
    
    return result;
  }
  
  /**
   * Ensure a value is a proper number before database operations
   * This is a final safety check before inserting into database
   */
  static ensureNumeric(value, fieldName = 'value') {
    if (value === null || value === undefined) {
      return null;
    }
    
    // If already a number and valid, return it
    if (typeof value === 'number' && isFinite(value) && !isNaN(value)) {
      return value;
    }
    
    // Clean and parse
    const cleaned = this.cleanNumericString(value);
    const parsed = parseFloat(cleaned);
    
    if (isNaN(parsed) || !isFinite(parsed)) {
      throw new Error(`Invalid numeric value for ${fieldName}: "${value}"`);
    }
    
    return Number(parsed);
  }
  /**
   * Create a new Physical Inventory as draft
   */
  static async createDraft(inventoryData, userId, companyId) {
    try {
      const {
        store_id,
        inventory_date,
        inventory_in_reason_id,
        inventory_out_reason_id,
        inventory_in_account_id,
        inventory_in_corresponding_account_id,
        inventory_out_account_id,
        inventory_out_corresponding_account_id,
        inventory_account_id, // Accounts selected during creation
        gain_account_id, // Accounts selected during creation
        loss_account_id, // Accounts selected during creation
        currency_id,
        exchange_rate,
        notes,
        items = []
      } = inventoryData;

      // Generate reference number
      const referenceNumber = await this.generateReferenceNumber(companyId);

      // Create the physical inventory record
      // Use a transaction to ensure atomicity
      const transaction = await PhysicalInventory.sequelize.transaction();
      
      try {
        const physicalInventory = await PhysicalInventory.create({
          reference_number: referenceNumber,
          inventory_date: inventory_date,
          store_id: store_id,
          inventory_in_reason_id: inventory_in_reason_id || null,
          inventory_out_reason_id: inventory_out_reason_id || null,
          inventory_in_account_id: inventory_in_account_id || null,
          inventory_in_corresponding_account_id: inventory_in_corresponding_account_id || null,
          inventory_out_account_id: inventory_out_account_id || null,
          inventory_out_corresponding_account_id: inventory_out_corresponding_account_id || null,
          inventory_account_id: inventory_account_id || null, // Save account selected during creation
          gain_account_id: gain_account_id || null, // Save account selected during creation
          loss_account_id: loss_account_id || null, // Save account selected during creation
          currency_id: currency_id,
          exchange_rate: this.safeParseFloat(exchange_rate, 1.0),
          status: 'draft',
          total_items: items.length,
          total_value: 0.00,
          created_by: userId,
          notes: notes || null,
          companyId: companyId // Add companyId for multi-tenant support
        }, { transaction });

        // Create items if provided
        let totalValue = 0;
        if (items && items.length > 0) {
          for (const item of items) {
            const calculatedValues = this.calculateItemValues(item);
            
            await PhysicalInventoryItem.create({
              physical_inventory_id: physicalInventory.id,
              product_id: item.product_id,
              current_quantity: this.safeParseFloat(item.current_quantity, 0),
              counted_quantity: this.safeParseFloat(item.counted_quantity, 0),
              adjustment_in_quantity: calculatedValues.adjustment_in_quantity,
              adjustment_out_quantity: calculatedValues.adjustment_out_quantity,
              adjustment_in_reason_id: item.adjustment_in_reason_id || null,
              adjustment_out_reason_id: item.adjustment_out_reason_id || null,
              unit_cost: this.safeParseFloat(item.unit_cost, 0),
              unit_average_cost: this.safeParseFloat(item.unit_average_cost, 0),
              new_stock: calculatedValues.new_stock,
              total_value: calculatedValues.total_value,
              delta_quantity: calculatedValues.delta_quantity,
              delta_value: calculatedValues.delta_value,
              exchange_rate: this.safeParseFloat(item.exchange_rate, 1.0),
              equivalent_amount: calculatedValues.equivalent_amount,
              expiry_date: this.validateDate(item.expiry_date),
              batch_number: item.batch_number || null,
              serial_numbers: item.serial_numbers || [],
              notes: item.notes || null,
              companyId: companyId // Add companyId for multi-tenant support
            }, { transaction });

            totalValue += calculatedValues.total_value;
          }

          // Update total value
          await physicalInventory.update({
            total_value: totalValue
          }, { transaction });
        }

        await transaction.commit();
        
        // Return the created inventory with related data
        return await this.getPhysicalInventoryById(physicalInventory.id);
      } catch (createError) {
        await transaction.rollback();
        throw createError;
      }
    } catch (error) {
      throw new Error(`Failed to create physical inventory draft: ${error.message}`);
    }
  }

  /**
   * Update an existing Physical Inventory
   */
  static async updatePhysicalInventory(id, inventoryData, userId, companyId) {
    try {
      const physicalInventory = await PhysicalInventory.findByPk(id);
      if (!physicalInventory) {
        throw new Error('Physical inventory not found');
      }

      // Check if inventory can be updated (draft or returned_for_correction status)
      if (physicalInventory.status !== 'draft' && physicalInventory.status !== 'returned_for_correction') {
        throw new Error('Only draft or returned for correction physical inventories can be updated');
      }

      const {
        store_id,
        inventory_date,
        inventory_in_reason_id,
        inventory_out_reason_id,
        inventory_in_account_id,
        inventory_in_corresponding_account_id,
        inventory_out_account_id,
        inventory_out_corresponding_account_id,
        inventory_account_id, // Accounts selected during creation
        gain_account_id, // Accounts selected during creation
        loss_account_id, // Accounts selected during creation
        currency_id,
        exchange_rate,
        notes,
        status,
        items = []
      } = inventoryData;

      // Prepare update data
      const updateData = {
        inventory_date: inventory_date,
        store_id: store_id,
        inventory_in_reason_id: inventory_in_reason_id,
        inventory_out_reason_id: inventory_out_reason_id,
        inventory_in_account_id: inventory_in_account_id,
        inventory_in_corresponding_account_id: inventory_in_corresponding_account_id,
        inventory_out_account_id: inventory_out_account_id,
        inventory_out_corresponding_account_id: inventory_out_corresponding_account_id,
        inventory_account_id: inventory_account_id, // Save account selected during creation
        gain_account_id: gain_account_id, // Save account selected during creation
        loss_account_id: loss_account_id, // Save account selected during creation
        currency_id: currency_id,
        exchange_rate: this.safeParseFloat(exchange_rate, 1.0),
        updated_by: userId,
        notes: notes
      };

      // If status is being changed to 'submitted', add submission details
      if (status === 'submitted') {
        updateData.status = 'submitted';
        updateData.submitted_at = new Date();
        updateData.submitted_by = userId;
      }

      // Update the physical inventory record
      await physicalInventory.update(updateData);

      // Delete existing items and recreate them
      try {
        await PhysicalInventoryItem.destroy({
          where: { physical_inventory_id: id }
        });

        // Create new items
        let totalValue = 0;
        
        if (items && items.length > 0) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const calculatedValues = this.calculateItemValues(item);
            
            try {
              const createdItem = await PhysicalInventoryItem.create({
                physical_inventory_id: id,
                product_id: item.product_id,
                current_quantity: this.safeParseFloat(item.current_quantity, 0),
                counted_quantity: this.safeParseFloat(item.counted_quantity, 0),
                adjustment_in_quantity: calculatedValues.adjustment_in_quantity,
                adjustment_out_quantity: calculatedValues.adjustment_out_quantity,
                adjustment_in_reason_id: item.adjustment_in_reason_id || null,
                adjustment_out_reason_id: item.adjustment_out_reason_id || null,
                unit_cost: this.safeParseFloat(item.unit_cost, 0),
                unit_average_cost: this.safeParseFloat(item.unit_average_cost, 0),
                new_stock: calculatedValues.new_stock,
                total_value: calculatedValues.total_value,
                delta_quantity: calculatedValues.delta_quantity,
                delta_value: calculatedValues.delta_value,
                exchange_rate: this.safeParseFloat(item.exchange_rate, 1.0),
                equivalent_amount: calculatedValues.equivalent_amount,
                expiry_date: this.validateDate(item.expiry_date),
                batch_number: item.batch_number || null,
                serial_numbers: item.serial_numbers || [],
                notes: item.notes || null,
                companyId: companyId // Add companyId for multi-tenant isolation
              });
              
              totalValue += calculatedValues.total_value;
            } catch (error) {
              throw error;
            }
          }

          // Update totals
          await physicalInventory.update({
            total_items: items.length,
            total_value: totalValue
          });
        } else {
          // No items, reset totals
          await physicalInventory.update({
            total_items: 0,
            total_value: 0.00
          });
        }
      } catch (itemsError) {
        throw new Error(`Failed to process items: ${itemsError.message}`);
      }

      // Return the updated inventory with related data
      return await this.getPhysicalInventoryById(id);
    } catch (error) {
      throw new Error(`Failed to update physical inventory: ${error.message}`);
    }
  }

  /**
   * Submit Physical Inventory for approval
   */
  static async submitPhysicalInventory(id, userId) {
    try {
      const physicalInventory = await PhysicalInventory.findByPk(id);
      if (!physicalInventory) {
        throw new Error('Physical inventory not found');
      }

      // Check if inventory can be submitted (draft or returned_for_correction status)
      if (physicalInventory.status !== 'draft' && physicalInventory.status !== 'returned_for_correction') {
        throw new Error('Only draft or returned for correction physical inventories can be submitted');
      }

      // Validate that inventory has items
      const itemCount = await PhysicalInventoryItem.count({
        where: { physical_inventory_id: id }
      });

      if (itemCount === 0) {
        throw new Error('Cannot submit physical inventory without items');
      }

      // Validate that required accounts are set before submission
      if (!physicalInventory.inventory_in_account_id || !physicalInventory.inventory_in_corresponding_account_id) {
        throw new Error('Inventory IN account and corresponding account are required before submission. Please set these accounts in the physical inventory details.');
      }

      if (!physicalInventory.inventory_out_account_id || !physicalInventory.inventory_out_corresponding_account_id) {
        throw new Error('Inventory OUT account and corresponding account are required before submission. Please set these accounts in the physical inventory details.');
      }

      // Verify the accounts exist
      const { Account } = require('../models');
      const inventoryInAccount = await Account.findByPk(physicalInventory.inventory_in_account_id);
      const inventoryInCorrespondingAccount = await Account.findByPk(physicalInventory.inventory_in_corresponding_account_id);
      const inventoryOutAccount = await Account.findByPk(physicalInventory.inventory_out_account_id);
      const inventoryOutCorrespondingAccount = await Account.findByPk(physicalInventory.inventory_out_corresponding_account_id);

      if (!inventoryInAccount || !inventoryInCorrespondingAccount) {
        throw new Error('Inventory IN accounts not found. The accounts may have been deleted. Please update the physical inventory with valid accounts.');
      }

      if (!inventoryOutAccount || !inventoryOutCorrespondingAccount) {
        throw new Error('Inventory OUT accounts not found. The accounts may have been deleted. Please update the physical inventory with valid accounts.');
      }

      // Update status to submitted
      await physicalInventory.update({
        status: 'submitted',
        submitted_by: userId,
        submitted_at: new Date()
      });

      return await this.getPhysicalInventoryById(id);
    } catch (error) {
      throw new Error(`Failed to submit physical inventory: ${error.message}`);
    }
  }

  /**
   * Approve Physical Inventory
   */
  static async approvePhysicalInventory(id, user, approvalNotes = null) {
    const transaction = await PhysicalInventory.sequelize.transaction();
    let hasRolledBack = false;
    
    try {
      // Build company filter
      const companyWhere = {};
      if (user.companyId && !user.isSystemAdmin) {
        companyWhere.companyId = user.companyId;
      }
      
      // Fetch the physical inventory with all related data (with company filter)
      const { Account, AccountType } = require('../models');
      const physicalInventory = await PhysicalInventory.findOne({
        where: {
          id: id,
          ...companyWhere
        },
        include: [
          {
            model: PhysicalInventoryItem,
            as: 'items',
            include: [
              {
                model: Product,
                as: 'product'
              }
            ]
          },
          {
            model: Store,
            as: 'store'
          },
          {
            model: Currency,
            as: 'currency'
          },
          {
            model: Account,
            as: 'inventoryInAccount',
            include: [
              {
                model: AccountType,
                as: 'accountType'
              }
            ]
          },
          {
            model: Account,
            as: 'inventoryInCorrespondingAccount',
            include: [
              {
                model: AccountType,
                as: 'accountType'
              }
            ]
          },
          {
            model: Account,
            as: 'inventoryOutAccount',
            include: [
              {
                model: AccountType,
                as: 'accountType'
              }
            ]
          },
          {
            model: Account,
            as: 'inventoryOutCorrespondingAccount',
            include: [
              {
                model: AccountType,
                as: 'accountType'
              }
            ]
          }
        ],
        transaction
      });

      if (!physicalInventory) {
        if (!hasRolledBack) {
          await transaction.rollback();
          hasRolledBack = true;
        }
        throw new Error('Physical inventory not found or access denied');
      }

      // CRITICAL: Clean exchange_rate immediately after fetching to prevent malformed values
      // Sequelize returns DECIMAL as strings, and if database has "1.0032.5", it will be returned as-is
      // We need to clean it before any calculations
      const rawExchangeRate = physicalInventory.exchange_rate;
      const cleanedExchangeRate = this.getSafeExchangeRate(physicalInventory, 1.0);
      
      // If the value was malformed, update it in the database
      if (rawExchangeRate && String(rawExchangeRate) !== String(cleanedExchangeRate)) {
        await physicalInventory.update({ exchange_rate: cleanedExchangeRate }, { transaction });
      }

      // Also clean all item exchange_rates
      if (physicalInventory.items && physicalInventory.items.length > 0) {
        for (const item of physicalInventory.items) {
          if (item.exchange_rate !== null && item.exchange_rate !== undefined) {
            const rawItemRate = item.exchange_rate;
            const cleanedItemRate = this.getSafeExchangeRate({ exchange_rate: item.exchange_rate }, cleanedExchangeRate);
            if (String(rawItemRate) !== String(cleanedItemRate)) {
              await item.update({ exchange_rate: cleanedItemRate }, { transaction });
            }
          }
        }
      }

      // Check if inventory can be approved (only submitted status)
      if (physicalInventory.status !== 'submitted') {
        if (!hasRolledBack) {
          await transaction.rollback();
          hasRolledBack = true;
        }
        throw new Error(`Only submitted physical inventories can be approved. Current status: ${physicalInventory.status}`);
      }

      // Validate that required accounts are set
      if (!physicalInventory.inventory_in_account_id || !physicalInventory.inventory_in_corresponding_account_id) {
        if (!hasRolledBack) {
          await transaction.rollback();
          hasRolledBack = true;
        }
        throw new Error('Inventory IN account and corresponding account are required for approval. Please set these accounts before submitting the physical inventory.');
      }

      if (!physicalInventory.inventory_out_account_id || !physicalInventory.inventory_out_corresponding_account_id) {
        if (!hasRolledBack) {
          await transaction.rollback();
          hasRolledBack = true;
        }
        throw new Error('Inventory OUT account and corresponding account are required for approval. Please set these accounts before submitting the physical inventory.');
      }

      // Verify the accounts exist
      if (!physicalInventory.inventoryInAccount || !physicalInventory.inventoryInCorrespondingAccount) {
        if (!hasRolledBack) {
          await transaction.rollback();
          hasRolledBack = true;
        }
        throw new Error('Inventory IN accounts not found. The accounts may have been deleted. Please update the physical inventory with valid accounts.');
      }

      if (!physicalInventory.inventoryOutAccount || !physicalInventory.inventoryOutCorrespondingAccount) {
        if (!hasRolledBack) {
          await transaction.rollback();
          hasRolledBack = true;
        }
        throw new Error('Inventory OUT accounts not found. The accounts may have been deleted. Please update the physical inventory with valid accounts.');
      }

      // Update inventory status
      await physicalInventory.update({
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date(),
        approval_notes: approvalNotes || null
      }, { transaction });

      // Process each item (similar to stock adjustment approval)
      for (const item of physicalInventory.items) {
        await this.processPhysicalInventoryItem(item, physicalInventory, user, transaction, physicalInventory.companyId);
      }

      await transaction.commit();
      return await this.getPhysicalInventoryById(id);
      
    } catch (error) {
      // Only rollback if we haven't already rolled back
      if (!hasRolledBack) {
        try {
          await transaction.rollback();
        } catch (rollbackError) {
          // Ignore rollback errors (transaction may already be finished)
        }
      }
      
      // Preserve validation error details
      if (error.name === 'SequelizeValidationError' && error.errors && error.errors.length > 0) {
        const validationDetails = error.errors.map(e => `${e.path}: ${e.message}`).join(', ');
        throw new Error(`Validation error: ${validationDetails}`);
      }
      
      throw new Error(`Failed to approve physical inventory: ${error.message}`);
    }
  }

  /**
   * Process Physical Inventory Item during approval
   */
  static async processPhysicalInventoryItem(item, physicalInventory, user, transaction, companyId) {
    try {
      // Ensure proper numeric conversion - handle string values that might have formatting issues
      // Use helper function to safely get exchange rate (similar to Stock Adjustment pattern)
      // Also check if item has its own exchange_rate that might be malformed
      let exchangeRate = this.getSafeExchangeRate(physicalInventory, 1.0);
      
      // If item has its own exchange_rate, use it (but clean it first)
      if (item.exchange_rate !== null && item.exchange_rate !== undefined) {
        exchangeRate = this.getSafeExchangeRate({ exchange_rate: item.exchange_rate }, exchangeRate);
      }
      
      const countedQuantity = this.safeParseFloat(item.counted_quantity, 0);
      const unitCost = this.safeParseFloat(item.unit_average_cost, 0);
      
      // Ensure all values are proper numbers (not strings)
      const finalCountedQuantity = Number(countedQuantity) || 0;
      const finalUnitCost = Number(unitCost) || 0;
      const finalExchangeRate = Number(exchangeRate);
      
      // Double-check: ensure exchangeRate is a valid number
      if (isNaN(finalExchangeRate) || !isFinite(finalExchangeRate)) {
        throw new Error(`Invalid exchange_rate: "${physicalInventory.exchange_rate}" (item: "${item.exchange_rate}")`);
      }
      
      // Validate parsed values
      if (isNaN(finalCountedQuantity) || isNaN(finalUnitCost) || isNaN(finalExchangeRate)) {
        throw new Error(`Invalid numeric values: counted_quantity="${item.counted_quantity}" (parsed: ${finalCountedQuantity}), unit_average_cost="${item.unit_average_cost}" (parsed: ${finalUnitCost}), exchange_rate="${physicalInventory.exchange_rate}" (parsed: ${finalExchangeRate})`);
      }
      
      // 1. Get CURRENT ProductStore quantity at approval time (not the old current_quantity from item)
      const { ProductStore } = require('../models');
      
      let productStore = await ProductStore.findOne({
        where: {
          product_id: item.product_id,
          store_id: physicalInventory.store_id,
          companyId: companyId // Add company filter for multi-tenant isolation
        },
        transaction
      });

      // Get the ACTUAL current quantity from ProductStore at approval time
      const actualCurrentQuantity = productStore ? this.safeParseFloat(productStore.quantity, 0) : 0;
      
      // Calculate delta from actual current quantity (not from item.current_quantity which is old)
      const deltaQuantity = finalCountedQuantity - actualCurrentQuantity;

      if (!productStore) {
        productStore = await ProductStore.create({
          product_id: item.product_id,
          store_id: physicalInventory.store_id,
          quantity: finalCountedQuantity,
          is_active: true,
          assigned_by: user.id,
          assigned_at: new Date(),
          companyId: companyId // Add companyId for multi-tenant support
        }, { transaction });
      } else {
        // Update to counted quantity (physical count is the truth)
        await productStore.update({
          quantity: finalCountedQuantity,
          last_updated: new Date()
        }, { transaction });
      }

      // 2. Create ProductTransaction record for audit trail
      const { ProductTransaction } = require('../models');
      const { FinancialYear } = require('../models');
      
      // Build company filter for FinancialYear
      const financialYearWhere = {
        isActive: true
      };
      if (companyId) {
        financialYearWhere.companyId = companyId;
      }
      
      const currentFinancialYear = await FinancialYear.findOne({
        where: financialYearWhere,
        transaction
      });
      
      if (currentFinancialYear) {
        // Get system default currency (with company filter)
        const Currency = require('../models/currency');
        const currencyWhere = {
          is_default: true
        };
        if (companyId) {
          currencyWhere.companyId = companyId;
        }
        
        const systemDefaultCurrency = await Currency.findOne({ 
          where: currencyWhere,
          transaction 
        });
        
        // Calculate equivalent amount with proper rounding
        const calculatedEquivalentAmount = finalUnitCost * finalExchangeRate;
        const roundedEquivalentAmount = Math.round(calculatedEquivalentAmount * 100) / 100; // Round to 2 decimal places
        
        await ProductTransaction.create({
          uuid: require('crypto').randomUUID(),
          system_date: new Date(),
          transaction_date: physicalInventory.inventory_date,
          financial_year_id: currentFinancialYear.id,
          financial_year_name: currentFinancialYear.name,
          transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type ID
          transaction_type_name: 'Physical Inventory',
          store_id: physicalInventory.store_id,
          product_id: item.product_id,
          product_type: item.product?.product_type || null,
          manufacturer_id: item.product?.manufacturer_id,
          model_id: item.product?.model_id,
          brand_name_id: item.product?.brand_id,
          packaging_id: item.product?.unit_id,
          packaging_issue_quantity: Math.abs(deltaQuantity),
          created_by_id: user.id,
          updated_by_id: user.id,
          product_average_cost: this.ensureNumeric(finalUnitCost, 'product_average_cost'),
          user_unit_cost: this.ensureNumeric(finalUnitCost, 'user_unit_cost'),
          equivalent_amount: this.ensureNumeric(roundedEquivalentAmount, 'equivalent_amount'),
          exchange_rate: this.ensureNumeric(finalExchangeRate, 'exchange_rate'),
          currency_id: physicalInventory.currency_id,
          system_currency_id: systemDefaultCurrency?.id,
          expiry_date: item.expiry_date,
          serial_number: item.serial_numbers ? item.serial_numbers.join(', ') : null,
          quantity_in: deltaQuantity > 0 ? deltaQuantity : 0,
          quantity_out: deltaQuantity < 0 ? Math.abs(deltaQuantity) : 0,
          reference_number: physicalInventory.reference_number,
          reference_type: 'Physical Inventory',
          notes: `Physical inventory adjustment: ${deltaQuantity > 0 ? 'Gain' : 'Loss'} of ${Math.abs(deltaQuantity)} units`,
          conversion_notes: `Approved by ${user.name || user.username}`,
          is_active: true,
          companyId: companyId // Add companyId for multi-tenant support
        }, { 
          transaction
          // Removed 'fields' option to ensure setters are called for all fields
          // This ensures exchange_rate and equivalent_amount are properly cleaned
        });
      }

      // 3. Handle serial numbers (if applicable)
      if (item.product?.track_serial_number && item.serial_numbers && item.serial_numbers.length > 0) {
        await this.processSerialNumbers(item, physicalInventory, user, transaction, companyId);
      }

      // 4. Handle expiry dates (if applicable)
      // Only process if expiry_date is provided (batch_number alone is not enough)
      if (item.expiry_date) {
        await this.processExpiryDates(item, physicalInventory, user, transaction, companyId);
      }

      // 5. Create General Ledger entries (if delta exists)
      if (deltaQuantity !== 0) {
        await this.createGeneralLedgerEntries(item, physicalInventory, user, transaction, companyId, physicalInventory.inventoryAccount, physicalInventory.gainAccount, physicalInventory.lossAccount);
      }

    } catch (error) {
      throw error;
    }
  }

  /**
   * Process Serial Numbers during approval
   */
  static async processSerialNumbers(item, physicalInventory, user, transaction, companyId) {
    try {
      const { ProductSerialNumber, Currency } = require('../models');
      // Ensure proper numeric conversion - handle multiple decimal points
      const countedQuantity = this.safeParseFloat(item.counted_quantity, 0);
      const deltaQuantity = this.safeParseFloat(item.delta_quantity, 0);
      const unitCost = this.safeParseFloat(item.unit_average_cost, 0);
      // Use helper function to safely get exchange rate (similar to Stock Adjustment pattern)
      const exchangeRate = this.getSafeExchangeRate(physicalInventory, 1.0);
      const serialNumbers = item.serial_numbers || [];
      
      // Get system default currency (with company filter)
      const currencyWhere = {
        is_default: true
      };
      if (companyId) {
        currencyWhere.companyId = companyId;
      }
      
      const systemDefaultCurrency = await Currency.findOne({ 
        where: currencyWhere,
        transaction 
      });
      
      if (!systemDefaultCurrency) {
        throw new Error('No system default currency found');
      }
      
      // Calculate quantity per serial number (distribute counted quantity across serials)
      const quantityPerSerial = serialNumbers.length > 0 ? countedQuantity / serialNumbers.length : 0;
      
      for (const serialNumber of serialNumbers) {
        let serialRecord = await ProductSerialNumber.findOne({
          where: {
            product_id: item.product_id,
            serial_number: serialNumber,
            store_id: physicalInventory.store_id,
            companyId: companyId // Add company filter for multi-tenant isolation
          },
          transaction
        });

        if (deltaQuantity > 0) {
          // Inventory Gain: Create or update serial number record
          if (!serialRecord) {
            await ProductSerialNumber.create({
              product_id: item.product_id,
              serial_number: serialNumber,
              store_id: physicalInventory.store_id,
              current_quantity: quantityPerSerial,
              total_quantity_received: quantityPerSerial,
              total_quantity_adjusted: quantityPerSerial,
              unit_cost: Number(unitCost),
              unit_cost_equivalent: Number((unitCost * exchangeRate).toFixed(2)),
              currency_id: physicalInventory.currency_id,
              system_currency_id: systemDefaultCurrency.id,
              exchange_rate: this.ensureNumeric(exchangeRate, 'exchange_rate'),
              product_average_cost: this.ensureNumeric(unitCost, 'product_average_cost'),
              user_unit_cost: this.ensureNumeric(unitCost, 'user_unit_cost'),
              equivalent_amount: this.ensureNumeric(Number((unitCost * exchangeRate).toFixed(2)), 'equivalent_amount'),
              status: 'active',
              notes: `Physical inventory: ${physicalInventory.reference_number}`,
              created_by_id: user.id,
              updated_by_id: user.id,
              is_active: true,
              companyId: companyId // Add companyId for multi-tenant isolation
            }, { transaction });
          } else {
            // Update existing serial record with the new counted quantity
            await serialRecord.update({
              current_quantity: quantityPerSerial,
              total_quantity_received: serialRecord.total_quantity_received + quantityPerSerial,
              total_quantity_adjusted: serialRecord.total_quantity_adjusted + quantityPerSerial,
              status: 'active'
            }, { transaction });
          }
        } else if (deltaQuantity < 0) {
          // Inventory Loss: Update serial number record
          if (serialRecord) {
            const newQuantity = Math.max(0, quantityPerSerial);
            await serialRecord.update({
              current_quantity: newQuantity,
              total_quantity_sold: serialRecord.total_quantity_sold + (serialRecord.current_quantity - newQuantity),
              total_quantity_adjusted: serialRecord.total_quantity_adjusted + (newQuantity - serialRecord.current_quantity),
              status: newQuantity <= 0 ? 'sold' : 'active'
            }, { transaction });
          }
        } else {
          // No delta: Just update to counted quantity
          if (serialRecord) {
            await serialRecord.update({
              current_quantity: quantityPerSerial,
              total_quantity_adjusted: serialRecord.total_quantity_adjusted + (quantityPerSerial - serialRecord.current_quantity),
              status: 'active'
            }, { transaction });
          } else if (quantityPerSerial > 0) {
            // Create new record even if no delta (counted quantity exists)
            await ProductSerialNumber.create({
              product_id: item.product_id,
              serial_number: serialNumber,
              store_id: physicalInventory.store_id,
              current_quantity: quantityPerSerial,
              total_quantity_received: quantityPerSerial,
              total_quantity_adjusted: quantityPerSerial,
              unit_cost: Number(unitCost),
              unit_cost_equivalent: Number((unitCost * exchangeRate).toFixed(2)),
              currency_id: physicalInventory.currency_id,
              system_currency_id: systemDefaultCurrency.id,
              exchange_rate: this.ensureNumeric(exchangeRate, 'exchange_rate'),
              product_average_cost: this.ensureNumeric(unitCost, 'product_average_cost'),
              user_unit_cost: this.ensureNumeric(unitCost, 'user_unit_cost'),
              equivalent_amount: this.ensureNumeric(Number((unitCost * exchangeRate).toFixed(2)), 'equivalent_amount'),
              status: 'active',
              notes: `Physical inventory: ${physicalInventory.reference_number}`,
              created_by_id: user.id,
              updated_by_id: user.id,
              is_active: true,
              companyId: companyId // Add companyId for multi-tenant isolation
            }, { transaction });
          }
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Process Expiry Dates during approval
   */
  static async processExpiryDates(item, physicalInventory, user, transaction, companyId) {
    try {
      const { ProductExpiryDate, Currency } = require('../models');
      const { Op } = require('sequelize');
      // Ensure proper numeric conversion - handle multiple decimal points
      const countedQuantity = this.safeParseFloat(item.counted_quantity, 0);
      const deltaQuantity = this.safeParseFloat(item.delta_quantity, 0);
      const unitCost = this.safeParseFloat(item.unit_average_cost, 0);
      // Use helper function to safely get exchange rate (similar to Stock Adjustment pattern)
      const exchangeRate = this.getSafeExchangeRate(physicalInventory, 1.0);
      
      // Get system default currency (with company filter)
      const currencyWhere = {
        is_default: true
      };
      if (companyId) {
        currencyWhere.companyId = companyId;
      }
      
      const systemDefaultCurrency = await Currency.findOne({ 
        where: currencyWhere,
        transaction 
      });
      
      if (!systemDefaultCurrency) {
        throw new Error('No system default currency found');
      }
      
      // Handle date comparison more robustly to avoid timezone issues
      const expiryDate = item.expiry_date ? new Date(item.expiry_date).toISOString().split('T')[0] : null;
      
      let expiryRecord = await ProductExpiryDate.findOne({
        where: {
          product_id: item.product_id,
          store_id: physicalInventory.store_id,
          batch_number: item.batch_number || null,
          companyId: companyId, // Add company filter for multi-tenant isolation
          // Use date comparison instead of exact datetime match
          [Op.and]: [
            expiryDate ? {
              expiry_date: {
                [Op.gte]: new Date(expiryDate + 'T00:00:00.000Z'),
                [Op.lt]: new Date(expiryDate + 'T23:59:59.999Z')
              }
            } : {}
          ]
        },
        transaction
      });

      if (deltaQuantity > 0) {
        // Inventory Gain: Create or update expiry record
        if (!expiryRecord) {
          // Ensure expiry_date is provided before creating
          if (!item.expiry_date) {
            throw new Error('expiry_date is required when creating ProductExpiryDate record');
          }
          
          const daysUntilExpiry = Math.ceil((new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
          
          await ProductExpiryDate.create({
            product_id: item.product_id,
            batch_number: item.batch_number || null,
            expiry_date: item.expiry_date,
            store_id: physicalInventory.store_id,
            current_quantity: countedQuantity,
            total_quantity_received: countedQuantity,
            total_quantity_adjusted: countedQuantity,
            unit_cost: Number(unitCost),
            unit_cost_equivalent: Number((unitCost * exchangeRate).toFixed(2)),
            currency_id: physicalInventory.currency_id,
            system_currency_id: systemDefaultCurrency.id,
            exchange_rate: Number(exchangeRate),
            product_average_cost: Number(unitCost),
            user_unit_cost: Number(unitCost),
            equivalent_amount: Number((unitCost * exchangeRate).toFixed(2)),
            status: 'active',
            days_until_expiry: daysUntilExpiry,
            is_expired: daysUntilExpiry < 0,
            notes: `Physical inventory: ${physicalInventory.reference_number}`,
            created_by_id: user.id,
            updated_by_id: user.id,
            is_active: true,
            companyId: companyId // Add companyId for multi-tenant isolation
          }, { transaction });
        } else {
          // Update existing record with counted quantity
          await expiryRecord.update({
            current_quantity: countedQuantity,
            total_quantity_received: expiryRecord.total_quantity_received + countedQuantity,
            total_quantity_adjusted: expiryRecord.total_quantity_adjusted + countedQuantity,
            status: 'active'
          }, { transaction });
        }
      } else if (deltaQuantity < 0) {
        // Inventory Loss: Update expiry record
        if (expiryRecord) {
          const newQuantity = Math.max(0, countedQuantity);
          await expiryRecord.update({
            current_quantity: newQuantity,
            total_quantity_sold: expiryRecord.total_quantity_sold + (expiryRecord.current_quantity - newQuantity),
            total_quantity_adjusted: expiryRecord.total_quantity_adjusted + (newQuantity - expiryRecord.current_quantity),
            status: newQuantity <= 0 ? 'sold' : 'active'
          }, { transaction });
        }
      } else {
        // No delta: Just update to counted quantity
        if (expiryRecord) {
          await expiryRecord.update({
            current_quantity: countedQuantity,
            total_quantity_adjusted: expiryRecord.total_quantity_adjusted + (countedQuantity - expiryRecord.current_quantity),
            status: 'active'
          }, { transaction });
        } else if (countedQuantity > 0) {
          // Create new record even if no delta (counted quantity exists)
          // Ensure expiry_date is provided before creating
          if (!item.expiry_date) {
            throw new Error('expiry_date is required when creating ProductExpiryDate record');
          }
          
          const daysUntilExpiry = Math.ceil((new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
          
          await ProductExpiryDate.create({
            product_id: item.product_id,
            batch_number: item.batch_number || null,
            expiry_date: item.expiry_date,
            store_id: physicalInventory.store_id,
            current_quantity: countedQuantity,
            total_quantity_received: countedQuantity,
            total_quantity_adjusted: countedQuantity,
            unit_cost: Number(unitCost),
            unit_cost_equivalent: Number((unitCost * exchangeRate).toFixed(2)),
            currency_id: physicalInventory.currency_id,
            system_currency_id: systemDefaultCurrency.id,
            exchange_rate: Number(exchangeRate),
            product_average_cost: Number(unitCost),
            user_unit_cost: Number(unitCost),
            equivalent_amount: Number((unitCost * exchangeRate).toFixed(2)),
            status: 'active',
            days_until_expiry: daysUntilExpiry,
            is_expired: daysUntilExpiry < 0,
            notes: `Physical inventory: ${physicalInventory.reference_number}`,
            created_by_id: user.id,
            updated_by_id: user.id,
            is_active: true,
            companyId: companyId // Add companyId for multi-tenant isolation
          }, { transaction });
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create General Ledger entries for inventory gains/losses
   * Uses IN accounts for gains (counted > current) and OUT accounts for losses (counted < current)
   */
  static async createGeneralLedgerEntries(item, physicalInventory, user, transaction, companyId) {
    try {
      const { GeneralLedger, FinancialYear, Currency } = require('../models');
      
      // Ensure proper numeric conversion - handle string values that might have formatting issues
      const deltaQuantity = this.safeParseFloat(item.delta_quantity, 0);
      const unitCost = this.safeParseFloat(item.unit_cost, 0);
      // Use helper function to safely get exchange rate (similar to Stock Adjustment pattern)
      const exchangeRate = this.getSafeExchangeRate(physicalInventory, 1.0);
      
      // Validate parsed values
      if (isNaN(deltaQuantity) || isNaN(unitCost) || isNaN(exchangeRate)) {
        throw new Error(`Invalid numeric values: delta_quantity="${item.delta_quantity}" (parsed: ${deltaQuantity}), unit_cost="${item.unit_cost}" (parsed: ${unitCost}), exchange_rate="${physicalInventory.exchange_rate}" (parsed: ${exchangeRate})`);
      }
      
      const deltaValue = Math.abs(deltaQuantity * unitCost);
      const equivalentAmount = deltaValue * exchangeRate;
      
      // Get system default currency (with company filter)
      const currencyWhere = {
        is_default: true
      };
      if (companyId) {
        currencyWhere.companyId = companyId;
      }
      
      const systemDefaultCurrency = await Currency.findOne({ 
        where: currencyWhere,
        transaction 
      });
      
      if (!systemDefaultCurrency) {
        throw new Error('No system default currency found');
      }
      
      // Build company filter for FinancialYear
      const financialYearWhere = {
        isActive: true
      };
      if (companyId) {
        financialYearWhere.companyId = companyId;
      }
      
      const currentFinancialYear = await FinancialYear.findOne({
        where: financialYearWhere,
        transaction
      });
      
      if (!currentFinancialYear) {
        return;
      }

      // Use IN accounts for gains (counted > current) and OUT accounts for losses (counted < current)
      const inventoryInAccount = physicalInventory.inventoryInAccount;
      const inventoryInCorrespondingAccount = physicalInventory.inventoryInCorrespondingAccount;
      const inventoryOutAccount = physicalInventory.inventoryOutAccount;
      const inventoryOutCorrespondingAccount = physicalInventory.inventoryOutCorrespondingAccount;

      if (deltaQuantity > 0) {
        // Inventory Gain (counted > current): Use IN accounts
        // Debit: Inventory IN Account, Credit: Inventory IN Corresponding Account
        if (!inventoryInAccount) {
          throw new Error(`Inventory IN account not found. Please ensure inventory_in_account_id is set on the physical inventory.`);
        }
        if (!inventoryInCorrespondingAccount) {
          throw new Error(`Inventory IN corresponding account not found. Please ensure inventory_in_corresponding_account_id is set on the physical inventory.`);
        }

        const inventoryInAccountType = inventoryInAccount.accountType || inventoryInAccount.account_type;
        const inventoryInCorrespondingAccountType = inventoryInCorrespondingAccount.accountType || inventoryInCorrespondingAccount.account_type;

        // Debit: Inventory IN Account
        await GeneralLedger.create({
          financial_year_code: currentFinancialYear.name,
          financial_year_id: currentFinancialYear.id,
          system_date: new Date(),
          transaction_date: physicalInventory.inventory_date,
          reference_number: physicalInventory.reference_number,
          transaction_type: 'PHYSICAL_INVENTORY',
          transaction_type_name: 'Physical Inventory',
          transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type ID
          created_by_code: user.id,
          created_by_name: user.name || user.username,
          description: `Physical inventory gain - ${item.product?.name} (${physicalInventory.reference_number})`,
          account_type_code: inventoryInAccountType?.code || 'ASSET',
          account_type_name: inventoryInAccountType?.name || 'Asset',
          account_type_id: inventoryInAccountType?.id,
          account_id: inventoryInAccount.id,
          account_name: inventoryInAccount.name,
          account_code: inventoryInAccount.code,
          account_nature: 'debit',
          exchange_rate: this.ensureNumeric(exchangeRate, 'exchange_rate'),
          amount: this.ensureNumeric(equivalentAmount, 'amount'),
          user_debit_amount: this.ensureNumeric(equivalentAmount, 'user_debit_amount'),
          user_credit_amount: 0,
          equivalent_debit_amount: this.ensureNumeric(equivalentAmount, 'equivalent_debit_amount'),
          equivalent_credit_amount: 0,
          system_currency_id: systemDefaultCurrency.id,
          username: user.username,
          companyId: companyId
        }, { transaction });

        // Credit: Inventory IN Corresponding Account
        await GeneralLedger.create({
          financial_year_code: currentFinancialYear.name,
          financial_year_id: currentFinancialYear.id,
          system_date: new Date(),
          transaction_date: physicalInventory.inventory_date,
          reference_number: physicalInventory.reference_number,
          transaction_type: 'PHYSICAL_INVENTORY',
          transaction_type_name: 'Physical Inventory',
          transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type ID
          created_by_code: user.id,
          created_by_name: user.name || user.username,
          description: `Physical inventory gain - ${item.product?.name} (${physicalInventory.reference_number})`,
          account_type_code: inventoryInCorrespondingAccountType?.code || 'INCOME',
          account_type_name: inventoryInCorrespondingAccountType?.name || 'Income',
          account_type_id: inventoryInCorrespondingAccountType?.id,
          account_id: inventoryInCorrespondingAccount.id,
          account_name: inventoryInCorrespondingAccount.name,
          account_code: inventoryInCorrespondingAccount.code,
          account_nature: 'credit',
          exchange_rate: this.ensureNumeric(exchangeRate, 'exchange_rate'),
          amount: this.ensureNumeric(equivalentAmount, 'amount'),
          user_debit_amount: 0,
          user_credit_amount: this.ensureNumeric(equivalentAmount, 'user_credit_amount'),
          equivalent_debit_amount: 0,
          equivalent_credit_amount: this.ensureNumeric(equivalentAmount, 'equivalent_credit_amount'),
          system_currency_id: systemDefaultCurrency.id,
          username: user.username,
          companyId: companyId
        }, { transaction });
        
      } else if (deltaQuantity < 0) {
        // Inventory Loss (counted < current): Use OUT accounts
        // Debit: Inventory OUT Corresponding Account, Credit: Inventory OUT Account
        if (!inventoryOutAccount) {
          throw new Error(`Inventory OUT account not found. Please ensure inventory_out_account_id is set on the physical inventory.`);
        }
        if (!inventoryOutCorrespondingAccount) {
          throw new Error(`Inventory OUT corresponding account not found. Please ensure inventory_out_corresponding_account_id is set on the physical inventory.`);
        }

        const inventoryOutAccountType = inventoryOutAccount.accountType || inventoryOutAccount.account_type;
        const inventoryOutCorrespondingAccountType = inventoryOutCorrespondingAccount.accountType || inventoryOutCorrespondingAccount.account_type;

        // Debit: Inventory OUT Corresponding Account
        await GeneralLedger.create({
          financial_year_code: currentFinancialYear.name,
          financial_year_id: currentFinancialYear.id,
          system_date: new Date(),
          transaction_date: physicalInventory.inventory_date,
          reference_number: physicalInventory.reference_number,
          transaction_type: 'PHYSICAL_INVENTORY',
          transaction_type_name: 'Physical Inventory',
          transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type ID
          created_by_code: user.id,
          created_by_name: user.name || user.username,
          description: `Physical inventory loss - ${item.product?.name} (${physicalInventory.reference_number})`,
          account_type_code: inventoryOutCorrespondingAccountType?.code || 'EXPENSE',
          account_type_name: inventoryOutCorrespondingAccountType?.name || 'Expense',
          account_type_id: inventoryOutCorrespondingAccountType?.id,
          account_id: inventoryOutCorrespondingAccount.id,
          account_name: inventoryOutCorrespondingAccount.name,
          account_code: inventoryOutCorrespondingAccount.code,
          account_nature: 'debit',
          exchange_rate: this.ensureNumeric(exchangeRate, 'exchange_rate'),
          amount: this.ensureNumeric(equivalentAmount, 'amount'),
          user_debit_amount: this.ensureNumeric(equivalentAmount, 'user_debit_amount'),
          user_credit_amount: 0,
          equivalent_debit_amount: this.ensureNumeric(equivalentAmount, 'equivalent_debit_amount'),
          equivalent_credit_amount: 0,
          system_currency_id: systemDefaultCurrency.id,
          username: user.username,
          companyId: companyId
        }, { transaction });

        // Credit: Inventory OUT Account
        await GeneralLedger.create({
          financial_year_code: currentFinancialYear.name,
          financial_year_id: currentFinancialYear.id,
          system_date: new Date(),
          transaction_date: physicalInventory.inventory_date,
          reference_number: physicalInventory.reference_number,
          transaction_type: 'PHYSICAL_INVENTORY',
          transaction_type_name: 'Physical Inventory',
          transaction_type_id: '582a880c-ce51-4779-a464-f07d20e62a80', // Stock Adjustment transaction type ID
          created_by_code: user.id,
          created_by_name: user.name || user.username,
          description: `Physical inventory loss - ${item.product?.name} (${physicalInventory.reference_number})`,
          account_type_code: inventoryOutAccountType?.code || 'ASSET',
          account_type_name: inventoryOutAccountType?.name || 'Asset',
          account_type_id: inventoryOutAccountType?.id,
          account_id: inventoryOutAccount.id,
          account_name: inventoryOutAccount.name,
          account_code: inventoryOutAccount.code,
          account_nature: 'credit',
          exchange_rate: this.ensureNumeric(exchangeRate, 'exchange_rate'),
          amount: this.ensureNumeric(equivalentAmount, 'amount'),
          user_debit_amount: 0,
          user_credit_amount: this.ensureNumeric(equivalentAmount, 'user_credit_amount'),
          equivalent_debit_amount: 0,
          equivalent_credit_amount: this.ensureNumeric(equivalentAmount, 'equivalent_credit_amount'),
          system_currency_id: systemDefaultCurrency.id,
          username: user.username,
          companyId: companyId
        }, { transaction });
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Reject Physical Inventory
   */
  static async rejectPhysicalInventory(id, rejectionReason, userId) {
    try {
      const physicalInventory = await PhysicalInventory.findByPk(id);
      if (!physicalInventory) {
        throw new Error('Physical inventory not found');
      }

      // Check if inventory can be rejected (only submitted status)
      if (physicalInventory.status !== 'submitted') {
        throw new Error('Only submitted physical inventories can be rejected');
      }

      // Update status to rejected
      await physicalInventory.update({
        status: 'rejected',
        rejection_reason: rejectionReason,
        approved_by: userId,
        approved_at: new Date()
      });

      return await this.getPhysicalInventoryById(id);
    } catch (error) {
      throw new Error(`Failed to reject physical inventory: ${error.message}`);
    }
  }

  /**
   * Return Physical Inventory for Correction
   */
  static async returnPhysicalInventoryForCorrection(id, returnReason, userId) {
    try {
      const physicalInventory = await PhysicalInventory.findByPk(id);
      if (!physicalInventory) {
        throw new Error('Physical inventory not found');
      }

      // Check if inventory can be returned (only submitted status)
      if (physicalInventory.status !== 'submitted') {
        throw new Error('Only submitted physical inventories can be returned for correction');
      }

      // Update status to returned_for_correction
      await physicalInventory.update({
        status: 'returned_for_correction',
        return_reason: returnReason,
        returned_by: userId,
        returned_at: new Date()
      });

      return await this.getPhysicalInventoryById(id);
    } catch (error) {
      throw new Error(`Failed to return physical inventory for correction: ${error.message}`);
    }
  }

  /**
   * Get Physical Inventory by ID with all related data
   * IMPORTANT: This method cleans all numeric values before returning to prevent malformed data
   */
  static async getPhysicalInventoryById(id) {
    try {
      const physicalInventory = await PhysicalInventory.findByPk(id, {
        include: [
          { model: Store, as: 'store' },
          { model: AdjustmentReason, as: 'inventoryInReason' },
          { model: AdjustmentReason, as: 'inventoryOutReason' },
          { model: Account, as: 'inventoryInAccount' },
          { model: Account, as: 'inventoryInCorrespondingAccount' },
          { model: Account, as: 'inventoryOutAccount' },
          { model: Account, as: 'inventoryOutCorrespondingAccount' },
          { model: Currency, as: 'currency' },
          { model: User, as: 'creator' },
          { model: User, as: 'updater' },
          { model: User, as: 'submitter' },
          { model: User, as: 'approver' },
          { model: User, as: 'returner' },
          { model: User, as: 'varianceAcceptor' },
          {
            model: PhysicalInventoryItem,
            as: 'items',
            include: [
              { model: Product, as: 'product' },
              { model: AdjustmentReason, as: 'adjustmentInReason' },
              { model: AdjustmentReason, as: 'adjustmentOutReason' }
            ]
          }
        ]
      });

      if (!physicalInventory) {
        throw new Error('Physical inventory not found');
      }

      return physicalInventory;
    } catch (error) {
      throw new Error(`Failed to fetch physical inventory: ${error.message}`);
    }
  }

  /**
   * Get Physical Inventories with pagination and filters
   */
  static async getPhysicalInventories(options, companyWhere = {}) {
    try {
      const { page = 1, limit = 10, search = '', status = '', storeId = '', startDate = '', endDate = '', sortBy = 'created_at', sortOrder = 'DESC' } = options;
      const offset = (page - 1) * limit;

      // Start with company filter - this is critical for multi-tenant isolation
      // Build where clause ensuring companyId is always included
      const whereConditions = [];
      
      // Handle company filter based on companyWhere parameter
      // If companyWhere has companyId, add it to filter (regular user)
      // If companyWhere is {} (empty), it's super-admin (no filter)
      // If companyWhere is undefined/null, it's an error (add impossible condition)
      if (companyWhere && companyWhere.companyId) {
        // Regular user: filter by companyId
        whereConditions.push({ companyId: companyWhere.companyId });
      } else if (companyWhere === undefined || companyWhere === null) {
        // Error case: should not happen, but prevent data leakage
        whereConditions.push({ id: null });
      }
      // If companyWhere is {} (empty object), it's super-admin - don't add any filter
      
      // Add other filters
      if (status && status !== 'all') {
        whereConditions.push({ status });
      }
      if (storeId) {
        whereConditions.push({ store_id: storeId });
      }
      if (startDate && endDate) {
        whereConditions.push({
          inventory_date: {
            [Op.between]: [startDate, endDate]
          }
        });
      } else if (startDate) {
        whereConditions.push({
          inventory_date: {
            [Op.gte]: startDate
          }
        });
      } else if (endDate) {
        whereConditions.push({
          inventory_date: {
            [Op.lte]: endDate
          }
        });
      }
      
      // Add search conditions
      if (search) {
        whereConditions.push({
          [Op.or]: [
            { reference_number: { [Op.iLike]: `%${search}%` } },
            { notes: { [Op.iLike]: `%${search}%` } },
          ]
        });
      }
      
      // Build final where clause
      // If no conditions, return empty object (super-admin gets all)
      // If one condition, return it directly
      // If multiple conditions, combine with Op.and
      const where = whereConditions.length === 0
        ? {} // Super-admin: no filter
        : whereConditions.length === 1 
          ? whereConditions[0] 
          : { [Op.and]: whereConditions };

      // Map frontend field names to database field names for ordering
      let order;
      if (sortBy === 'store_name') {
        order = [[{ model: Store, as: 'store' }, 'name', sortOrder]];
      } else if (sortBy === 'created_by_name') {
        order = [[{ model: User, as: 'creator' }, 'first_name', sortOrder]];
      } else if (sortBy === 'updated_by_name') {
        order = [[{ model: User, as: 'updater' }, 'first_name', sortOrder]];
      } else if (sortBy === 'submitted_by_name') {
        order = [[{ model: User, as: 'submitter' }, 'first_name', sortOrder]];
      } else if (sortBy === 'approved_by_name') {
        order = [[{ model: User, as: 'approver' }, 'first_name', sortOrder]];
      } else if (sortBy === 'inventory_date') {
        order = [['inventory_date', sortOrder]];
      } else if (sortBy === 'created_at') {
        order = [['created_at', sortOrder]];
      } else if (sortBy === 'updated_at') {
        order = [['updated_at', sortOrder]];
      } else if (sortBy === 'submitted_at') {
        order = [['submitted_at', sortOrder]];
      } else if (sortBy === 'approved_at') {
        order = [['approved_at', sortOrder]];
      } else {
        order = [[sortBy, sortOrder]];
      }

      const { count, rows } = await PhysicalInventory.findAndCountAll({
        where,
        limit,
        offset,
        order,
        include: [
          { 
            model: Store, 
            as: 'store',
            attributes: ['id', 'name'],
            required: false
          },
          { 
            model: AdjustmentReason, 
            as: 'inventoryInReason',
            attributes: ['id', 'name', 'code', 'adjustment_type']
          },
          { 
            model: AdjustmentReason, 
            as: 'inventoryOutReason',
            attributes: ['id', 'name', 'code', 'adjustment_type']
          },
          { 
            model: Currency, 
            as: 'currency',
            attributes: ['id', 'name', 'code', 'symbol']
          },
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'first_name', 'last_name', 'email']
          },
          {
            model: User,
            as: 'updater',
            attributes: ['id', 'first_name', 'last_name', 'email']
          },
          {
            model: User,
            as: 'submitter',
            attributes: ['id', 'first_name', 'last_name', 'email']
          },
          {
            model: User,
            as: 'approver',
            attributes: ['id', 'first_name', 'last_name', 'email']
          },
          {
            model: User,
            as: 'returner',
            attributes: ['id', 'first_name', 'last_name', 'email']
          },
          {
            model: User,
            as: 'varianceAcceptor',
            attributes: ['id', 'first_name', 'last_name', 'email']
          }
        ]
      });

      // Transform the data to include computed fields
      const transformedPhysicalInventories = rows.map(inventory => ({
        ...inventory.toJSON(),
        store_name: inventory.store?.name || 'Unknown Store',
        inventory_in_reason_name: inventory.inventoryInReason?.name || null,
        inventory_out_reason_name: inventory.inventoryOutReason?.name || null,
        currency_symbol: inventory.currency?.symbol || '$',
        created_by_name: inventory.creator ? `${inventory.creator.first_name} ${inventory.creator.last_name}` : 'System',
        updated_by_name: inventory.updater ? `${inventory.updater.first_name} ${inventory.updater.last_name}` : null,
        submitted_by_name: inventory.submitter ? `${inventory.submitter.first_name} ${inventory.submitter.last_name}` : null,
        approved_by_name: inventory.approver ? `${inventory.approver.first_name} ${inventory.approver.last_name}` : null,
        companyId: inventory.companyId // Explicitly include companyId for verification
      }));

      return {
        physicalInventories: transformedPhysicalInventories,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(count / limit),
          totalItems: count,
          pageSize: limit,
        },
      };
    } catch (error) {
      throw new Error(`Failed to fetch physical inventories: ${error.message}`);
    }
  }

  /**
   * Delete Physical Inventory
   */
  static async deletePhysicalInventory(id) {
    try {
      const physicalInventory = await PhysicalInventory.findByPk(id);
      if (!physicalInventory) {
        throw new Error('Physical inventory not found');
      }

      // Check if inventory can be deleted (only draft status)
      if (physicalInventory.status !== 'draft') {
        throw new Error('Only draft physical inventories can be deleted');
      }

      // Delete the inventory (items will be deleted by CASCADE)
      await physicalInventory.destroy();

      return { success: true, message: 'Physical inventory deleted successfully' };
    } catch (error) {
      throw new Error(`Failed to delete physical inventory: ${error.message}`);
    }
  }

  /**
   * Accept Variance for Physical Inventory
   */
  static async acceptVariance(id, varianceData, userId) {
    try {
      const physicalInventory = await PhysicalInventory.findByPk(id);
      if (!physicalInventory) {
        throw new Error('Physical inventory not found');
      }

      // Check if inventory can have variance accepted (only submitted status)
      if (physicalInventory.status !== 'submitted') {
        throw new Error('Only submitted physical inventories can have variance accepted');
      }

      // Update variance acceptance fields
      await physicalInventory.update({
        variance_accepted_by: userId,
        variance_accepted_at: new Date(),
        total_delta_value: varianceData.totalDeltaValue || 0,
        positive_delta_value: varianceData.positiveDeltaValue || 0,
        negative_delta_value: varianceData.negativeDeltaValue || 0,
        variance_notes: varianceData.notes || null
      });

      return await this.getPhysicalInventoryById(id);
    } catch (error) {
      throw new Error(`Failed to accept variance: ${error.message}`);
    }
  }

  /**
   * Calculate item values based on current and counted quantities
   */
  static calculateItemValues(item) {
    const currentQuantity = this.safeParseFloat(item.current_quantity, 0);
    const countedQuantity = this.safeParseFloat(item.counted_quantity, 0);
    const unitCost = this.safeParseFloat(item.unit_cost, 0);
    const unitAverageCost = this.safeParseFloat(item.unit_average_cost, unitCost);
    const exchangeRate = this.safeParseFloat(item.exchange_rate, 1.0);

    // Calculate adjustment quantities
    const difference = countedQuantity - currentQuantity;
    const adjustmentInQuantity = difference > 0 ? difference : 0;
    const adjustmentOutQuantity = difference < 0 ? Math.abs(difference) : 0;

    // Calculate delta quantities and values
    const deltaQuantity = difference;
    const deltaValue = deltaQuantity * unitAverageCost;

    // Calculate new stock (same as counted quantity)
    const newStock = countedQuantity;

    // Calculate total value based on counted quantity
    const totalValue = countedQuantity * unitCost;

    // Calculate equivalent amount
    const equivalentAmount = totalValue * exchangeRate;

    return {
      adjustment_in_quantity: adjustmentInQuantity,
      adjustment_out_quantity: adjustmentOutQuantity,
      delta_quantity: deltaQuantity,
      delta_value: deltaValue,
      new_stock: newStock,
      total_value: totalValue,
      equivalent_amount: equivalentAmount
    };
  }

  /**
   * Generate reference number
   * Note: Reference numbers are not required to be unique - same reference can be used multiple times
   */
  static async generateReferenceNumber(companyId = null) {
    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `PI-${timestamp}-${randomSuffix}`;
  }

  /**
   * Validate and format date string
   */
  static validateDate(dateString) {
    if (!dateString || dateString === '' || dateString === 'Invalid date') {
      return null;
    }
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return null;
    }
    
    return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
  }

  /**
   * Get Physical Inventory statistics
   */
  static async getPhysicalInventoryStats(companyId = null) {
    try {
      const whereClause = {};
      if (companyId) {
        whereClause.companyId = companyId;
      }

      const totalInventories = await PhysicalInventory.count({ where: whereClause });
      const draftInventories = await PhysicalInventory.count({ where: { ...whereClause, status: 'draft' } });
      const submittedInventories = await PhysicalInventory.count({ where: { ...whereClause, status: 'submitted' } });
      const approvedInventories = await PhysicalInventory.count({ where: { ...whereClause, status: 'approved' } });
      const rejectedInventories = await PhysicalInventory.count({ where: { ...whereClause, status: 'rejected' } });

      return {
        totalInventories,
        totalDraft: draftInventories,
        totalSubmitted: submittedInventories,
        totalApproved: approvedInventories,
        totalRejected: rejectedInventories
      };
    } catch (error) {
      throw new Error(`Failed to fetch physical inventory stats: ${error.message}`);
    }
  }
}

module.exports = PhysicalInventoryService;