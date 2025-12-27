const { SalesTransaction, FinancialYear } = require('../models');
const { Op } = require('sequelize');
const { buildCompanyWhere } = require('../middleware/companyFilter');

/**
 * Generate a unique transaction reference number
 * Format: ST-YYYYMMDD-XXXX (e.g., ST-20250126-0001)
 * Sequential per company, continues across dates
 */
const generateTransactionRefNumber = async (req, transactionType) => {
  const today = new Date();
  const dateString = today.getFullYear().toString() + 
                    (today.getMonth() + 1).toString().padStart(2, '0') + 
                    today.getDate().toString().padStart(2, '0');
  
  const companyId = req.user?.companyId;
  
  if (!companyId) {
    throw new Error('Company ID is required to generate transaction reference number');
  }

  // Get the last transaction for this company (regardless of date) to continue the sequence
  const lastTransaction = await SalesTransaction.findOne({
    where: {
      companyId,
      transaction_ref_number: {
        [Op.like]: 'ST-%'
      }
    },
    attributes: ['transaction_ref_number'],
    order: [['transaction_ref_number', 'DESC']]
  });

  // Extract the sequence number from the last transaction
  let nextSequence = 1;
  if (lastTransaction && lastTransaction.transaction_ref_number) {
    const match = lastTransaction.transaction_ref_number.match(/ST-\d{8}-(\d{4})/);
    if (match) {
      nextSequence = parseInt(match[1]) + 1;
    }
  }

  // Generate the reference number with today's date and the next sequence number
  const referenceNumber = `ST-${dateString}-${nextSequence.toString().padStart(4, '0')}`;

  // Double-check that this number doesn't exist (safety check, filtered by company)
  const existing = await SalesTransaction.findOne({
    where: {
      companyId,
      transaction_ref_number: referenceNumber
    },
    attributes: ['id']
  });

  if (existing) {
    // If it exists (shouldn't happen, but safety check), increment and try again
    nextSequence++;
    return `ST-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
  }

  return referenceNumber;
};

/**
 * Get or determine financial year for a transaction
 * If financial_year_id is provided, use it; otherwise get current financial year
 */
const getFinancialYearForTransaction = async (req, transactionDate, providedFinancialYearId = null) => {
  if (providedFinancialYearId) {
    // Validate that the provided financial year exists and belongs to the company
    const financialYear = await FinancialYear.findOne({
      where: buildCompanyWhere(req, { id: providedFinancialYearId })
    });
    if (financialYear) {
      return financialYear;
    }
  }

  // Get current financial year
  const currentFinancialYear = await FinancialYear.findOne({
    where: buildCompanyWhere(req, { isCurrent: true, isActive: true })
  });

  if (!currentFinancialYear) {
    throw new Error('No current financial year found. Please set up a current financial year before creating transactions.');
  }

  // Validate transaction date is within financial year range (if date provided)
  if (transactionDate) {
    const transactionDateStr = transactionDate.split('T')[0]; // Get YYYY-MM-DD part only
    const startDateStr = currentFinancialYear.startDate.split('T')[0];
    const endDateStr = currentFinancialYear.endDate.split('T')[0];
    
    if (transactionDateStr < startDateStr || transactionDateStr > endDateStr) {
    }
  }

  return currentFinancialYear;
};

/**
 * Create sales transactions from a sales invoice (one per invoice item/product)
 */
const createTransactionFromInvoice = async (invoice, req, transactionOptions = {}) => {
  try {
    if (!req.user || !req.user.companyId) {
      throw new Error('Company ID is required to create sales transaction');
    }

    // Get financial year for the transaction
    const financialYear = await getFinancialYearForTransaction(
      req, 
      invoice.invoice_date, 
      invoice.financial_year_id
    );

    // Get all invoice items with their products
    const { SalesInvoiceItem } = require('../models');
    const invoiceItems = await SalesInvoiceItem.findAll({
      where: { sales_invoice_id: invoice.id, companyId: req.user.companyId },
      include: [{
        model: require('../models').Product,
        as: 'product',
        attributes: ['id', 'product_type', 'category_id', 'brand_id', 'manufacturer_id', 'model_id', 'color_id', 'store_location_id', 'default_packaging_id', 'unit_id']
      }],
      order: [['created_at', 'ASC']],
      transaction: transactionOptions.transaction || null
    });

    if (!invoiceItems || invoiceItems.length === 0) {
      return [];
    }

    const createdTransactions = [];
    const { ProductPriceCategory } = require('../models');
    let baseTransactionRefNumber = null; // Store base ref number for reuse

    // Create one transaction per invoice item/product
    for (let index = 0; index < invoiceItems.length; index++) {
      const item = invoiceItems[index];
      
      if (!item.product) {
        continue;
      }

      // Get product attributes directly from Product model
      const productId = item.product.id;
      const productAttributes = {
        product_type: item.product.product_type || null,
        product_category_id: item.product.category_id || null,
        brand_name_id: item.product.brand_id || null,
        manufacturer_id: item.product.manufacturer_id || null,
        model_id: item.product.model_id || null,
        color_id: item.product.color_id || null,
        store_location_id: item.product.store_location_id || null,
        packaging_id: item.product.default_packaging_id || item.product.unit_id || null,
        price_category_id: null
      };

      // Get price category from ProductPriceCategory (if available)
      try {
        const priceCategory = await ProductPriceCategory.findOne({
          where: { product_id: productId, companyId: req.user.companyId },
          order: [['created_at', 'ASC']],
          transaction: transactionOptions.transaction || null
        });
        if (priceCategory) {
          productAttributes.price_category_id = priceCategory.price_category_id || null;
        }
      } catch (error) {
        // Continue if price category lookup fails
      }

      // Generate transaction reference number (add suffix for multiple items)
      // Only generate base number once for the first item
      let transactionRefNumber;
      if (index === 0) {
        baseTransactionRefNumber = await generateTransactionRefNumber(req, 'invoice');
        transactionRefNumber = invoiceItems.length > 1 
          ? `${baseTransactionRefNumber}-${String(index + 1).padStart(2, '0')}`
          : baseTransactionRefNumber;
      } else {
        // For subsequent items, use the same base but with incremented suffix
        transactionRefNumber = `${baseTransactionRefNumber}-${String(index + 1).padStart(2, '0')}`;
      }

      // Calculate item-level amounts (proportional to invoice totals for multi-item invoices)
      // For single item, use invoice totals; for multiple items, use item line_total
      const itemSubtotal = parseFloat(item.line_total || 0) - parseFloat(item.tax_amount || 0) - parseFloat(item.wht_amount || 0) + parseFloat(item.discount_amount || 0);
      const itemTotal = parseFloat(item.line_total || 0);
      const itemDiscount = parseFloat(item.discount_amount || 0);
      const itemTax = parseFloat(item.tax_amount || 0);
      const itemWht = parseFloat(item.wht_amount || 0);
      const itemAfterDiscount = parseFloat(item.amount_after_discount || 0);
      const itemAfterWht = parseFloat(item.amount_after_wht || 0);
      const itemEquivalentAmount = parseFloat(item.equivalent_amount || 0);

      // For paid/balance amounts, distribute proportionally if multiple items
      const invoiceTotal = parseFloat(invoice.total_amount || 0);
      const itemProportion = invoiceTotal > 0 ? itemTotal / invoiceTotal : 0;
      const itemPaidAmount = parseFloat(invoice.paid_amount || 0) * itemProportion;
      const itemBalanceAmount = itemTotal - itemPaidAmount;

      const salesTransaction = await SalesTransaction.create({
        transaction_ref_number: transactionRefNumber,
        transaction_type: 'invoice',
        companyId: req.user.companyId,
        source_invoice_id: invoice.id,
        transaction_date: invoice.invoice_date,
        due_date: invoice.due_date || null,
        store_id: invoice.store_id,
        customer_id: invoice.customer_id,
        sales_agent_id: invoice.sales_agent_id || null,
        financial_year_id: financialYear.id,
        subtotal: itemSubtotal,
        discount_amount: itemDiscount,
        tax_amount: itemTax,
        total_wht_amount: itemWht,
        amount_after_discount: itemAfterDiscount,
        amount_after_wht: itemAfterWht,
        total_amount: itemTotal,
        paid_amount: itemPaidAmount,
        balance_amount: itemBalanceAmount,
        equivalent_amount: itemEquivalentAmount,
        currency_id: invoice.currency_id || null,
        exchange_rate: invoice.exchange_rate || 1.000000,
        exchange_rate_id: invoice.exchange_rate_id || null,
        system_default_currency_id: invoice.system_default_currency_id || null,
        status: invoice.status || 'draft',
        is_active: invoice.status !== 'cancelled',
        is_cancelled: invoice.status === 'cancelled',
        notes: invoice.notes || null,
        terms_conditions: invoice.terms_conditions || null,
        receipt_invoice_number: invoice.receipt_invoice_number || invoice.invoice_ref_number || null,
        receipt_number: invoice.receipt_number || null,
        // Product details (from Product model, not invoice)
        product_id: productId,
        product_type: productAttributes.product_type,
        product_category_id: productAttributes.product_category_id,
        brand_name_id: productAttributes.brand_name_id,
        manufacturer_id: productAttributes.manufacturer_id,
        model_id: productAttributes.model_id,
        color_id: productAttributes.color_id,
        packaging_id: productAttributes.packaging_id,
        price_category_id: productAttributes.price_category_id,
        store_location_id: productAttributes.store_location_id,
        created_by: req.user.id,
        updated_by: req.user.id,
        sent_by: invoice.sent_by || null,
        sent_at: invoice.sent_at || null,
        approved_by: invoice.approved_by || null,
        approved_at: invoice.approved_at || null,
        cancelled_by: invoice.cancelled_by || null,
        cancelled_at: invoice.cancelled_at || null,
        rejected_by: invoice.rejected_by || null,
        rejected_at: invoice.rejected_at || null
      }, transactionOptions);

      createdTransactions.push(salesTransaction);
    }

    return createdTransactions.length === 1 ? createdTransactions[0] : createdTransactions;
  } catch (error) {
    console.error('Error creating sales transactions from invoice:', error);
    throw error;
  }
};

/**
 * Create a sales transaction from a sales order
 */
const createTransactionFromOrder = async (order, req, transactionOptions = {}) => {
  try {
    if (!req.user || !req.user.companyId) {
      throw new Error('Company ID is required to create sales transaction');
    }

    // Get financial year for the transaction
    const financialYear = await getFinancialYearForTransaction(
      req, 
      order.sales_order_date, 
      order.financial_year_id
    );

    const transactionRefNumber = await generateTransactionRefNumber(req, 'order');

    // Get product details from the first order item (primary product)
    // This ensures we populate product data from actual Product model, not from order items
    let productId = null;
    let productAttributes = {
      product_type: null,
      product_category_id: null,
      brand_name_id: null,
      manufacturer_id: null,
      model_id: null,
      color_id: null,
      packaging_id: null,
      price_category_id: null,
      store_location_id: null
    };

    try {
      const { SalesOrderItem } = require('../models');
      const firstItem = await SalesOrderItem.findOne({
        where: { sales_order_id: order.id, companyId: req.user.companyId },
        include: [{
          model: require('../models').Product,
          as: 'product',
          attributes: ['id', 'product_type', 'category_id', 'brand_id', 'manufacturer_id', 'model_id', 'color_id', 'store_location_id', 'default_packaging_id', 'unit_id']
        }],
        order: [['created_at', 'ASC']],
        transaction: transactionOptions.transaction || null
      });

      if (firstItem && firstItem.product) {
        // Save the actual product_id
        productId = firstItem.product.id;
        
        // Get all product attributes directly from Product model (not from order item)
        productAttributes.product_type = firstItem.product.product_type || null;
        productAttributes.product_category_id = firstItem.product.category_id || null;
        productAttributes.brand_name_id = firstItem.product.brand_id || null;
        productAttributes.manufacturer_id = firstItem.product.manufacturer_id || null;
        productAttributes.model_id = firstItem.product.model_id || null;
        productAttributes.color_id = firstItem.product.color_id || null;
        productAttributes.store_location_id = firstItem.product.store_location_id || null;
        productAttributes.packaging_id = firstItem.product.default_packaging_id || firstItem.product.unit_id || null;
        
        // Get price category from ProductPriceCategory (if available)
        const { ProductPriceCategory } = require('../models');
        const priceCategory = await ProductPriceCategory.findOne({
          where: { product_id: firstItem.product.id, companyId: req.user.companyId },
          order: [['created_at', 'ASC']],
          transaction: transactionOptions.transaction || null
        });
        if (priceCategory) {
          productAttributes.price_category_id = priceCategory.price_category_id || null;
        }
      }
    } catch (error) {
    }

    const salesTransaction = await SalesTransaction.create({
      transaction_ref_number: transactionRefNumber,
      transaction_type: 'order',
      companyId: req.user.companyId,
      source_order_id: order.id,
      transaction_date: order.sales_order_date,
      valid_until: order.valid_until || null,
      delivery_date: order.delivery_date || null,
      store_id: order.store_id,
      customer_id: order.customer_id,
      sales_agent_id: null, // Sales orders don't have sales_agent_id
      financial_year_id: financialYear.id,
      subtotal: parseFloat(order.subtotal || 0),
      discount_amount: parseFloat(order.discount_amount || 0),
      tax_amount: parseFloat(order.tax_amount || 0),
      total_wht_amount: parseFloat(order.total_wht_amount || 0),
      amount_after_discount: parseFloat(order.amount_after_discount || 0),
      amount_after_wht: parseFloat(order.amount_after_wht || 0),
      total_amount: parseFloat(order.total_amount || 0),
      paid_amount: 0.00, // Orders don't have paid amounts
      balance_amount: parseFloat(order.total_amount || 0), // Full balance for orders
      equivalent_amount: parseFloat(order.equivalent_amount || 0),
      currency_id: order.currency_id || null,
      exchange_rate: order.exchange_rate || 1.000000,
      exchange_rate_id: order.exchange_rate_id || null,
      system_default_currency_id: order.system_default_currency_id || null,
      status: order.status || 'draft',
      is_active: order.status !== 'cancelled',
      is_cancelled: order.status === 'cancelled',
      notes: order.notes || null,
      terms_conditions: order.terms_conditions || null,
      shipping_address: order.shipping_address || null,
      // Product details (from Product model, not order)
      product_id: productId,
      product_type: productAttributes.product_type,
      product_category_id: productAttributes.product_category_id,
      brand_name_id: productAttributes.brand_name_id,
      manufacturer_id: productAttributes.manufacturer_id,
      model_id: productAttributes.model_id,
      color_id: productAttributes.color_id,
      packaging_id: productAttributes.packaging_id,
      price_category_id: productAttributes.price_category_id,
      store_location_id: productAttributes.store_location_id,
      created_by: req.user.id,
      updated_by: req.user.id,
      sent_by: order.sent_by || null,
      sent_at: order.sent_at || null,
      accepted_by: order.accepted_by || null,
      accepted_at: order.accepted_at || null,
      rejected_by: order.rejected_by || null,
      rejected_at: order.rejected_at || null
    }, transactionOptions);

    return salesTransaction;
  } catch (error) {
    console.error('Error creating sales transaction from order:', error);
    throw error;
  }
};

/**
 * Update existing sales transactions from an invoice (one per invoice item/product)
 */
const updateTransactionFromInvoice = async (invoice, req, transactionOptions = {}) => {
  try {
    if (!req.user || !req.user.companyId) {
      throw new Error('Company ID is required to update sales transaction');
    }

    // Find all existing transactions for this invoice
    const existingTransactions = await SalesTransaction.findAll({
      where: {
        companyId: req.user.companyId,
        source_invoice_id: invoice.id
      },
      order: [['created_at', 'ASC']],
      transaction: transactionOptions.transaction || null
    });

    // Get all invoice items with their products
    const { SalesInvoiceItem } = require('../models');
    const invoiceItems = await SalesInvoiceItem.findAll({
      where: { sales_invoice_id: invoice.id, companyId: req.user.companyId },
      include: [{
        model: require('../models').Product,
        as: 'product',
        attributes: ['id', 'product_type', 'category_id', 'brand_id', 'manufacturer_id', 'model_id', 'color_id', 'store_location_id', 'default_packaging_id', 'unit_id']
      }],
      order: [['created_at', 'ASC']],
      transaction: transactionOptions.transaction || null
    });

    if (!invoiceItems || invoiceItems.length === 0) {
      // If no items, delete all existing transactions
      if (existingTransactions.length > 0) {
        await SalesTransaction.destroy({
          where: {
            companyId: req.user.companyId,
            source_invoice_id: invoice.id
          },
          transaction: transactionOptions.transaction || null
        });
      }
      return [];
    }

    // If no existing transactions, create them
    if (existingTransactions.length === 0) {
      return await createTransactionFromInvoice(invoice, req, transactionOptions);
    }

    // Get financial year for the transaction
    const financialYear = await getFinancialYearForTransaction(
      req, 
      invoice.invoice_date, 
      invoice.financial_year_id
    );

    const updatedTransactions = [];
    const usedTransactionIds = new Set(); // Track which transactions have been used
    const { ProductPriceCategory } = require('../models');

    // Update or create transactions for each invoice item
    for (let index = 0; index < invoiceItems.length; index++) {
      const item = invoiceItems[index];
      
      if (!item.product) {
        continue;
      }

      // Get product attributes directly from Product model
      const productId = item.product.id;
      const productAttributes = {
        product_type: item.product.product_type || null,
        product_category_id: item.product.category_id || null,
        brand_name_id: item.product.brand_id || null,
        manufacturer_id: item.product.manufacturer_id || null,
        model_id: item.product.model_id || null,
        color_id: item.product.color_id || null,
        store_location_id: item.product.store_location_id || null,
        packaging_id: item.product.default_packaging_id || item.product.unit_id || null,
        price_category_id: null
      };

      // Get price category from ProductPriceCategory (if available)
      try {
        const priceCategory = await ProductPriceCategory.findOne({
          where: { product_id: productId, companyId: req.user.companyId },
          order: [['created_at', 'ASC']],
          transaction: transactionOptions.transaction || null
        });
        if (priceCategory) {
          productAttributes.price_category_id = priceCategory.price_category_id || null;
        }
      } catch (error) {
        // Continue if price category lookup fails
      }

      // Calculate item-level amounts
      const itemSubtotal = parseFloat(item.line_total || 0) - parseFloat(item.tax_amount || 0) - parseFloat(item.wht_amount || 0) + parseFloat(item.discount_amount || 0);
      const itemTotal = parseFloat(item.line_total || 0);
      const itemDiscount = parseFloat(item.discount_amount || 0);
      const itemTax = parseFloat(item.tax_amount || 0);
      const itemWht = parseFloat(item.wht_amount || 0);
      const itemAfterDiscount = parseFloat(item.amount_after_discount || 0);
      const itemAfterWht = parseFloat(item.amount_after_wht || 0);
      const itemEquivalentAmount = parseFloat(item.equivalent_amount || 0);

      // For paid/balance amounts, distribute proportionally if multiple items
      const invoiceTotal = parseFloat(invoice.total_amount || 0);
      const itemProportion = invoiceTotal > 0 ? itemTotal / invoiceTotal : 0;
      const itemPaidAmount = parseFloat(invoice.paid_amount || 0) * itemProportion;
      const itemBalanceAmount = itemTotal - itemPaidAmount;

      // Find existing transaction for this product
      // First try to match by position (index), then by product_id
      let existingTransaction = null;
      if (index < existingTransactions.length && !usedTransactionIds.has(existingTransactions[index].id)) {
        const txAtIndex = existingTransactions[index];
        if (txAtIndex.product_id === productId) {
          existingTransaction = txAtIndex;
          usedTransactionIds.add(txAtIndex.id);
        }
      }
      
      // If not found at index, search for transaction with matching product_id that hasn't been used
      if (!existingTransaction) {
        existingTransaction = existingTransactions.find(tx => 
          tx.product_id === productId && !usedTransactionIds.has(tx.id)
        );
        if (existingTransaction) {
          usedTransactionIds.add(existingTransaction.id);
        }
      }

      if (existingTransaction) {
        // Update existing transaction
        await existingTransaction.update({
          transaction_date: invoice.invoice_date,
          due_date: invoice.due_date || null,
          store_id: invoice.store_id,
          customer_id: invoice.customer_id,
          sales_agent_id: invoice.sales_agent_id || null,
          financial_year_id: financialYear.id,
          subtotal: itemSubtotal,
          discount_amount: itemDiscount,
          tax_amount: itemTax,
          total_wht_amount: itemWht,
          amount_after_discount: itemAfterDiscount,
          amount_after_wht: itemAfterWht,
          total_amount: itemTotal,
          paid_amount: itemPaidAmount,
          balance_amount: itemBalanceAmount,
          equivalent_amount: itemEquivalentAmount,
      currency_id: invoice.currency_id || null,
      exchange_rate: invoice.exchange_rate || 1.000000,
      exchange_rate_id: invoice.exchange_rate_id || null,
      system_default_currency_id: invoice.system_default_currency_id || null,
      status: invoice.status || 'draft',
      is_active: invoice.status !== 'cancelled',
      is_cancelled: invoice.status === 'cancelled',
      notes: invoice.notes || null,
      terms_conditions: invoice.terms_conditions || null,
      receipt_invoice_number: invoice.receipt_invoice_number || invoice.invoice_ref_number || null,
      receipt_number: invoice.receipt_number || null,
      // Product details (from Product model, not invoice)
      product_id: productId,
      product_type: productAttributes.product_type,
      product_category_id: productAttributes.product_category_id,
      brand_name_id: productAttributes.brand_name_id,
      manufacturer_id: productAttributes.manufacturer_id,
      model_id: productAttributes.model_id,
      color_id: productAttributes.color_id,
      packaging_id: productAttributes.packaging_id,
      price_category_id: productAttributes.price_category_id,
      store_location_id: productAttributes.store_location_id,
      updated_by: req.user.id,
      sent_by: invoice.sent_by || null,
      sent_at: invoice.sent_at || null,
      approved_by: invoice.approved_by || null,
      approved_at: invoice.approved_at || null,
          cancelled_by: invoice.cancelled_by || null,
          cancelled_at: invoice.cancelled_at || null,
          rejected_by: invoice.rejected_by || null,
          rejected_at: invoice.rejected_at || null
        }, transactionOptions);
        updatedTransactions.push(existingTransaction);
      } else {
        // Create new transaction for this product
        // Reuse base ref number from existing transactions if available, otherwise generate new one
        let baseTransactionRefNumber;
        if (existingTransactions.length > 0) {
          // Extract base from existing transaction (remove suffix if present)
          const existingRef = existingTransactions[0].transaction_ref_number;
          baseTransactionRefNumber = existingRef.includes('-') && existingRef.match(/-\d{2}$/) 
            ? existingRef.replace(/-\d{2}$/, '')
            : existingRef;
        } else {
          baseTransactionRefNumber = await generateTransactionRefNumber(req, 'invoice');
        }
        const transactionRefNumber = invoiceItems.length > 1 
          ? `${baseTransactionRefNumber}-${String(index + 1).padStart(2, '0')}`
          : baseTransactionRefNumber;

        const newTransaction = await SalesTransaction.create({
          transaction_ref_number: transactionRefNumber,
          transaction_type: 'invoice',
          companyId: req.user.companyId,
          source_invoice_id: invoice.id,
          transaction_date: invoice.invoice_date,
          due_date: invoice.due_date || null,
          store_id: invoice.store_id,
          customer_id: invoice.customer_id,
          sales_agent_id: invoice.sales_agent_id || null,
          financial_year_id: financialYear.id,
          subtotal: itemSubtotal,
          discount_amount: itemDiscount,
          tax_amount: itemTax,
          total_wht_amount: itemWht,
          amount_after_discount: itemAfterDiscount,
          amount_after_wht: itemAfterWht,
          total_amount: itemTotal,
          paid_amount: itemPaidAmount,
          balance_amount: itemBalanceAmount,
          equivalent_amount: itemEquivalentAmount,
          currency_id: invoice.currency_id || null,
          exchange_rate: invoice.exchange_rate || 1.000000,
          exchange_rate_id: invoice.exchange_rate_id || null,
          system_default_currency_id: invoice.system_default_currency_id || null,
          status: invoice.status || 'draft',
          is_active: invoice.status !== 'cancelled',
          is_cancelled: invoice.status === 'cancelled',
          notes: invoice.notes || null,
          terms_conditions: invoice.terms_conditions || null,
          receipt_invoice_number: invoice.receipt_invoice_number || invoice.invoice_ref_number || null,
          receipt_number: invoice.receipt_number || null,
          // Product details (from Product model, not invoice)
          product_id: productId,
          product_type: productAttributes.product_type,
          product_category_id: productAttributes.product_category_id,
          brand_name_id: productAttributes.brand_name_id,
          manufacturer_id: productAttributes.manufacturer_id,
          model_id: productAttributes.model_id,
          color_id: productAttributes.color_id,
          packaging_id: productAttributes.packaging_id,
          price_category_id: productAttributes.price_category_id,
          store_location_id: productAttributes.store_location_id,
          created_by: req.user.id,
          updated_by: req.user.id,
          sent_by: invoice.sent_by || null,
          sent_at: invoice.sent_at || null,
          approved_by: invoice.approved_by || null,
          approved_at: invoice.approved_at || null,
          cancelled_by: invoice.cancelled_by || null,
          cancelled_at: invoice.cancelled_at || null,
          rejected_by: invoice.rejected_by || null,
          rejected_at: invoice.rejected_at || null
        }, transactionOptions);
        updatedTransactions.push(newTransaction);
      }
    }

    // Delete transactions that weren't used (products removed from invoice)
    const transactionsToDelete = existingTransactions.filter(tx => !usedTransactionIds.has(tx.id));
    
    if (transactionsToDelete.length > 0) {
      const { Op } = require('sequelize');
      const idsToDelete = transactionsToDelete.map(tx => tx.id);
      await SalesTransaction.destroy({
        where: {
          id: { [Op.in]: idsToDelete },
          companyId: req.user.companyId
        },
        transaction: transactionOptions.transaction || null
      });
    }

    return updatedTransactions.length === 1 ? updatedTransactions[0] : updatedTransactions;
  } catch (error) {
    console.error('Error updating sales transactions from invoice:', error);
    throw error;
  }
};

/**
 * Update an existing sales transaction from an order
 */
const updateTransactionFromOrder = async (order, req, transactionOptions = {}) => {
  try {
    if (!req.user || !req.user.companyId) {
      throw new Error('Company ID is required to update sales transaction');
    }

    // Find existing transaction by source_order_id
    const existingTransaction = await SalesTransaction.findOne({
      where: {
        companyId: req.user.companyId,
        source_order_id: order.id
      }
    }, transactionOptions);

    if (!existingTransaction) {
      // If transaction doesn't exist, create it
      return await createTransactionFromOrder(order, req, transactionOptions);
    }

    // Get financial year for the transaction
    const financialYear = await getFinancialYearForTransaction(
      req, 
      order.sales_order_date, 
      order.financial_year_id
    );

    // Get product details from the first order item (primary product)
    // This ensures we populate product data from actual Product model, not from order items
    let productId = null;
    let productAttributes = {
      product_type: null,
      product_category_id: null,
      brand_name_id: null,
      manufacturer_id: null,
      model_id: null,
      color_id: null,
      packaging_id: null,
      price_category_id: null,
      store_location_id: null
    };

    try {
      const { SalesOrderItem } = require('../models');
      const firstItem = await SalesOrderItem.findOne({
        where: { sales_order_id: order.id, companyId: req.user.companyId },
        include: [{
          model: require('../models').Product,
          as: 'product',
          attributes: ['id', 'product_type', 'category_id', 'brand_id', 'manufacturer_id', 'model_id', 'color_id', 'store_location_id', 'default_packaging_id', 'unit_id']
        }],
        order: [['created_at', 'ASC']],
        transaction: transactionOptions.transaction || null
      });

      if (firstItem && firstItem.product) {
        // Save the actual product_id
        productId = firstItem.product.id;
        
        // Get all product attributes directly from Product model (not from order item)
        productAttributes.product_type = firstItem.product.product_type || null;
        productAttributes.product_category_id = firstItem.product.category_id || null;
        productAttributes.brand_name_id = firstItem.product.brand_id || null;
        productAttributes.manufacturer_id = firstItem.product.manufacturer_id || null;
        productAttributes.model_id = firstItem.product.model_id || null;
        productAttributes.color_id = firstItem.product.color_id || null;
        productAttributes.store_location_id = firstItem.product.store_location_id || null;
        productAttributes.packaging_id = firstItem.product.default_packaging_id || firstItem.product.unit_id || null;
        
        // Get price category from ProductPriceCategory (if available)
        const { ProductPriceCategory } = require('../models');
        const priceCategory = await ProductPriceCategory.findOne({
          where: { product_id: firstItem.product.id, companyId: req.user.companyId },
          order: [['created_at', 'ASC']],
          transaction: transactionOptions.transaction || null
        });
        if (priceCategory) {
          productAttributes.price_category_id = priceCategory.price_category_id || null;
        }
      }
    } catch (error) {
    }

    // Update existing transaction
    await existingTransaction.update({
      transaction_date: order.sales_order_date,
      valid_until: order.valid_until || null,
      delivery_date: order.delivery_date || null,
      store_id: order.store_id,
      customer_id: order.customer_id,
      financial_year_id: financialYear.id,
      subtotal: parseFloat(order.subtotal || 0),
      discount_amount: parseFloat(order.discount_amount || 0),
      tax_amount: parseFloat(order.tax_amount || 0),
      total_wht_amount: parseFloat(order.total_wht_amount || 0),
      amount_after_discount: parseFloat(order.amount_after_discount || 0),
      amount_after_wht: parseFloat(order.amount_after_wht || 0),
      total_amount: parseFloat(order.total_amount || 0),
      equivalent_amount: parseFloat(order.equivalent_amount || 0),
      currency_id: order.currency_id || null,
      exchange_rate: order.exchange_rate || 1.000000,
      exchange_rate_id: order.exchange_rate_id || null,
      system_default_currency_id: order.system_default_currency_id || null,
      status: order.status || 'draft',
      is_active: order.status !== 'cancelled',
      is_cancelled: order.status === 'cancelled',
      notes: order.notes || null,
      terms_conditions: order.terms_conditions || null,
      shipping_address: order.shipping_address || null,
      // Product details (from Product model, not order)
      product_id: productId,
      product_type: productAttributes.product_type,
      product_category_id: productAttributes.product_category_id,
      brand_name_id: productAttributes.brand_name_id,
      manufacturer_id: productAttributes.manufacturer_id,
      model_id: productAttributes.model_id,
      color_id: productAttributes.color_id,
      packaging_id: productAttributes.packaging_id,
      price_category_id: productAttributes.price_category_id,
      store_location_id: productAttributes.store_location_id,
      updated_by: req.user.id,
      sent_by: order.sent_by || null,
      sent_at: order.sent_at || null,
      accepted_by: order.accepted_by || null,
      accepted_at: order.accepted_at || null,
      rejected_by: order.rejected_by || null,
      rejected_at: order.rejected_at || null
    }, transactionOptions);

    return existingTransaction;
  } catch (error) {
    console.error('Error updating sales transaction from order:', error);
    throw error;
  }
};

module.exports = {
  generateTransactionRefNumber,
  getFinancialYearForTransaction,
  createTransactionFromInvoice,
  createTransactionFromOrder,
  updateTransactionFromInvoice,
  updateTransactionFromOrder
};

