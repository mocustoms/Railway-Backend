const cron = require('node-cron');
const { Op } = require('sequelize');
const sequelize = require('../../config/database');
const {
  SalesInvoice,
  SalesInvoiceItem,
  Company,
  FinancialYear
} = require('../models');

/**
 * Check if a recurring invoice should be generated based on its schedule
 */
function shouldGenerateRecurringInvoice(invoice, now = new Date()) {
  if (invoice.scheduled_type !== 'recurring' || !invoice.recurring_period) {
    return false;
  }

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const currentDate = now.getDate();
  const currentMonth = now.getMonth(); // 0 = January, 11 = December

  // Check time window if specified
  if (invoice.start_time && invoice.end_time) {
    const [startHour, startMinute] = invoice.start_time.split(':').map(Number);
    const [endHour, endMinute] = invoice.end_time.split(':').map(Number);
    
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    const startTimeMinutes = startHour * 60 + startMinute;
    const endTimeMinutes = endHour * 60 + endMinute;

    if (currentTimeMinutes < startTimeMinutes || currentTimeMinutes > endTimeMinutes) {
      return false;
    }
  }

  // Check based on recurring period
  switch (invoice.recurring_period) {
    case 'daily':
      return true; // Daily invoices are generated every day (within time window if specified)

    case 'weekly':
      if (!invoice.recurring_day_of_week) return false;
      const dayMap = {
        'sunday': 0,
        'monday': 1,
        'tuesday': 2,
        'wednesday': 3,
        'thursday': 4,
        'friday': 5,
        'saturday': 6
      };
      return currentDay === dayMap[invoice.recurring_day_of_week.toLowerCase()];

    case 'monthly':
      if (!invoice.recurring_date) return false;
      return currentDate === invoice.recurring_date;

    case 'yearly':
      if (!invoice.recurring_date || !invoice.recurring_month) return false;
      const monthMap = {
        'january': 0,
        'february': 1,
        'march': 2,
        'april': 3,
        'may': 4,
        'june': 5,
        'july': 6,
        'august': 7,
        'september': 8,
        'october': 9,
        'november': 10,
        'december': 11
      };
      return currentDate === invoice.recurring_date && currentMonth === monthMap[invoice.recurring_month.toLowerCase()];

    default:
      return false;
  }
}

/**
 * Check if a one-time scheduled invoice should be generated
 */
function shouldGenerateOneTimeInvoice(invoice, now = new Date()) {
  if (invoice.scheduled_type !== 'one_time' || !invoice.scheduled_date) {
    return false;
  }

  const scheduledDate = new Date(invoice.scheduled_date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const scheduledDay = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), scheduledDate.getDate());

  // Check if scheduled date is today
  return today.getTime() === scheduledDay.getTime();
}

/**
 * Generate invoice reference number following the normal invoice sequence
 * IMPORTANT: This is per-company sequential. The sequence continues across dates.
 * Example: INV-20251106-0001 → INV-20251107-0002 → INV-20251107-0003 → INV-20251108-0004
 * Different companies CAN have the same reference number (e.g., Company A and Company B can both have INV-20251107-0001)
 * The unique constraint is composite: ['invoice_ref_number', 'companyId'], allowing duplicates across companies.
 */
async function generateInvoiceRefNumber(companyId, transaction) {
  const today = new Date();
  const dateString = today.getFullYear().toString() + 
                    (today.getMonth() + 1).toString().padStart(2, '0') + 
                    today.getDate().toString().padStart(2, '0');
  
  if (!companyId) {
    throw new Error('Company ID is required to generate invoice reference number');
  }
  
  // Get the LAST invoice for this company (regardless of date) to continue the sequence
  // Order by invoice_ref_number DESC to get the highest sequence number
  const lastInvoice = await SalesInvoice.findOne({
    where: {
      companyId: companyId,
      invoice_ref_number: {
        [Op.like]: 'INV-%' // Match any date
      }
    },
    attributes: ['invoice_ref_number'],
    order: [['invoice_ref_number', 'DESC']],
    transaction
  });
  
  // Extract the sequence number from the last invoice
  let nextSequence = 1;
  if (lastInvoice && lastInvoice.invoice_ref_number) {
    const match = lastInvoice.invoice_ref_number.match(/INV-\d{8}-(\d{4})/);
    if (match) {
      nextSequence = parseInt(match[1]) + 1;
    }
  }
  
  // Keep trying until we find a unique reference number
  // This handles race conditions where multiple scheduled invoices are generated simultaneously
  const maxAttempts = 100; // Safety limit to prevent infinite loops
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    // Generate the reference number with today's date and the next sequence number
    const referenceNumber = `INV-${dateString}-${nextSequence.toString().padStart(4, '0')}`;
    
    // Double-check that this number doesn't exist (safety check, filtered by company)
    try {
      const existing = await SalesInvoice.findOne({
        where: {
          invoice_ref_number: referenceNumber,
          companyId: companyId
        },
        attributes: ['id'],
        transaction
      });
      
      if (!existing) {
        return referenceNumber;
      }
    } catch (queryError) {
      // If query fails, try next sequence anyway
    }
    
    nextSequence++;
    attempts++;
  }
  
  // If we've exhausted all attempts, throw an error
  throw new Error(`Failed to generate unique invoice reference number after ${maxAttempts} attempts`);
}

/**
 * Create a new invoice from a scheduled parent invoice
 */
async function createInvoiceFromSchedule(parentInvoice, transaction) {
  const now = new Date();
  
  // Get financial year
  const financialYear = await FinancialYear.findOne({
    where: {
      companyId: parentInvoice.companyId,
      isActive: true
    },
    transaction
  });

  if (!financialYear) {
    throw new Error('Active financial year not found');
  }

  // Generate invoice reference number following the normal invoice sequence
  const invoiceRefNumber = await generateInvoiceRefNumber(parentInvoice.companyId, transaction);

  // Check if invoice with this ref number already exists (prevent duplicates)
  const existingInvoice = await SalesInvoice.findOne({
    where: {
      invoice_ref_number: invoiceRefNumber,
      companyId: parentInvoice.companyId
    },
    transaction
  });

  if (existingInvoice) {
    return null;
  }

  // Calculate due date (use same logic as parent or default to 30 days)
  let dueDate = null;
  if (parentInvoice.due_date) {
    const parentDueDate = new Date(parentInvoice.due_date);
    const parentInvoiceDate = new Date(parentInvoice.invoice_date);
    const daysDiff = Math.floor((parentDueDate - parentInvoiceDate) / (1000 * 60 * 60 * 24));
    dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + daysDiff);
  } else {
    dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + 30); // Default 30 days
  }

  // Create new invoice in draft status
  const newInvoice = await SalesInvoice.create({
    invoice_ref_number: invoiceRefNumber,
    invoice_date: now,
    due_date: dueDate,
    store_id: parentInvoice.store_id,
    customer_id: parentInvoice.customer_id,
    sales_order_id: parentInvoice.sales_order_id,
    proforma_invoice_id: parentInvoice.proforma_invoice_id,
    currency_id: parentInvoice.currency_id,
    exchange_rate: parentInvoice.exchange_rate,
    system_default_currency_id: parentInvoice.system_default_currency_id,
    companyId: parentInvoice.companyId,
    exchange_rate_id: parentInvoice.exchange_rate_id,
    subtotal: parentInvoice.subtotal,
    tax_amount: parentInvoice.tax_amount,
    discount_amount: parentInvoice.discount_amount,
    total_amount: parentInvoice.total_amount,
    amount_after_discount: parentInvoice.amount_after_discount,
    total_wht_amount: parentInvoice.total_wht_amount,
    amount_after_wht: parentInvoice.amount_after_wht,
    paid_amount: 0.00,
    balance_amount: parentInvoice.total_amount,
    equivalent_amount: parentInvoice.equivalent_amount,
    price_category_id: parentInvoice.price_category_id,
    sales_agent_id: parentInvoice.sales_agent_id,
    financial_year_id: financialYear.id,
    discount_allowed_account_id: parentInvoice.discount_allowed_account_id,
    account_receivable_id: parentInvoice.account_receivable_id,
    status: 'draft', // Always create in draft status
    scheduled_type: 'not_scheduled', // Generated invoices are not scheduled
    parent_invoice_id: parentInvoice.id, // Link to parent
    notes: parentInvoice.notes ? `${parentInvoice.notes}\n[Auto-generated from ${parentInvoice.invoice_ref_number}]` : `[Auto-generated from ${parentInvoice.invoice_ref_number}]`,
    terms_conditions: parentInvoice.terms_conditions,
    created_by: parentInvoice.created_by,
    updated_by: parentInvoice.created_by
  }, { transaction });

  // Get parent invoice items
  const parentItems = await SalesInvoiceItem.findAll({
    where: {
      sales_invoice_id: parentInvoice.id,
      companyId: parentInvoice.companyId
    },
    transaction
  });

  // Create items for new invoice
  const newItems = await Promise.all(
    parentItems.map(async (parentItem) => {
      return await SalesInvoiceItem.create({
        sales_invoice_id: newInvoice.id,
        product_id: parentItem.product_id,
        quantity: parentItem.quantity,
        companyId: parentInvoice.companyId,
        financial_year_id: financialYear.id,
        unit_price: parentItem.unit_price,
        discount_percentage: parentItem.discount_percentage,
        discount_amount: parentItem.discount_amount,
        tax_percentage: parentItem.tax_percentage,
        tax_amount: parentItem.tax_amount,
        price_tax_inclusive: parentItem.price_tax_inclusive,
        sales_tax_id: parentItem.sales_tax_id,
        wht_tax_id: parentItem.wht_tax_id,
        wht_amount: parentItem.wht_amount,
        currency_id: parentItem.currency_id,
        exchange_rate: parentItem.exchange_rate,
        equivalent_amount: parentItem.equivalent_amount,
        amount_after_discount: parentItem.amount_after_discount,
        amount_after_wht: parentItem.amount_after_wht,
        line_total: parentItem.line_total,
        notes: parentItem.notes,
        serial_numbers: parentItem.serial_numbers, // Note: Serial numbers should be empty for generated invoices
        batch_number: parentItem.batch_number, // Note: Batch numbers should be empty for generated invoices
        expiry_date: parentItem.expiry_date, // Note: Expiry dates should be empty for generated invoices
        created_by: parentInvoice.created_by,
        updated_by: parentInvoice.created_by
      }, { transaction });
    })
  );

  return newInvoice;
}

/**
 * Check and generate scheduled invoices
 */
async function checkAndGenerateScheduledInvoices() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  try {
    // Get all active companies
    const companies = await Company.findAll({
      where: { isActive: true }
    });

    let totalGenerated = 0;
    let totalErrors = 0;

    for (const company of companies) {
      const transaction = await sequelize.transaction();
      
      try {
        // Find all scheduled invoices that are not cancelled/rejected
        // Only check invoices that are the parent (not generated ones)
        const scheduledInvoices = await SalesInvoice.findAll({
          where: {
            companyId: company.id,
            scheduled_type: {
              [Op.in]: ['recurring', 'one_time']
            },
            status: {
              [Op.notIn]: ['cancelled', 'rejected']
            },
            parent_invoice_id: null // Only parent invoices
          },
          transaction
        });

        for (const invoice of scheduledInvoices) {
          try {
            let shouldGenerate = false;

            // Check if invoice should be generated
            if (invoice.scheduled_type === 'recurring') {
              shouldGenerate = shouldGenerateRecurringInvoice(invoice, now);
            } else if (invoice.scheduled_type === 'one_time') {
              shouldGenerate = shouldGenerateOneTimeInvoice(invoice, now);
            }

            if (shouldGenerate) {
              // Check if invoice was already generated today (prevent duplicates)
              const existingToday = await SalesInvoice.findOne({
                where: {
                  parent_invoice_id: invoice.id,
                  companyId: company.id,
                  invoice_date: {
                    [Op.gte]: today,
                    [Op.lt]: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                  }
                },
                transaction
              });

              if (!existingToday) {
                const newInvoice = await createInvoiceFromSchedule(invoice, transaction);
                if (newInvoice) {
                  totalGenerated++;
                }
              }
            }
          } catch (invoiceError) {
            totalErrors++;
            // Continue with next invoice
          }
        }

        await transaction.commit();
      } catch (companyError) {
        await transaction.rollback();
        totalErrors++;
        // Continue with next company
      }
    }
  } catch (error) {
    // Fatal error in scheduled invoice generator
  }
}

// Store task reference globally
let scheduledInvoiceTask = null;

/**
 * Initialize and start the scheduled invoice generator
 * Runs every hour to check for invoices that need to be generated
 */
function startScheduledInvoiceGenerator() {
  // If task already exists, stop it first
  if (scheduledInvoiceTask) {
    scheduledInvoiceTask.stop();
    scheduledInvoiceTask = null;
  }

  // Schedule: Run every hour at minute 0
  // Cron format: minute hour day month dayOfWeek
  // '0 * * * *' = At minute 0 of every hour
  const cronSchedule = '0 * * * *';

  // Run immediately on startup (for testing/debugging)
  // Comment out in production if you only want it to run at scheduled time
  // Wrap in try-catch to prevent startup failure
  checkAndGenerateScheduledInvoices().catch(() => {
    // Error in initial scheduled invoice check
  });

  // Schedule the task with error handling
  scheduledInvoiceTask = cron.schedule(cronSchedule, async () => {
    try {
      await checkAndGenerateScheduledInvoices();
    } catch (error) {
      // Don't stop the task - it will continue running
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  return scheduledInvoiceTask;
}

/**
 * Stop the scheduled invoice generator
 */
function stopScheduledInvoiceGenerator() {
  if (scheduledInvoiceTask) {
    scheduledInvoiceTask.stop();
    scheduledInvoiceTask = null;
    return true;
  }
  return false;
}

/**
 * Get the status of the scheduled invoice generator
 */
function getScheduledInvoiceGeneratorStatus() {
  return {
    isRunning: scheduledInvoiceTask !== null && scheduledInvoiceTask.getStatus() === 'scheduled',
    taskStatus: scheduledInvoiceTask ? scheduledInvoiceTask.getStatus() : 'not_started'
  };
}

module.exports = {
  startScheduledInvoiceGenerator,
  stopScheduledInvoiceGenerator,
  getScheduledInvoiceGeneratorStatus,
  checkAndGenerateScheduledInvoices,
  shouldGenerateRecurringInvoice,
  shouldGenerateOneTimeInvoice
};

