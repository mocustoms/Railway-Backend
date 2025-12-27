const sequelize = require('../config/database');
const { 
  SalesInvoice, 
  Customer, 
  LoyaltyCard, 
  LoyaltyCardConfig, 
  LoyaltyTransaction,
  FinancialYear,
  Currency
} = require('../server/models');
const { buildCompanyWhere } = require('../server/middleware/companyFilter');

// Mock req object
function createMockReq(userId, companyId) {
  return {
    user: {
      id: userId,
      companyId: companyId
    }
  };
}

async function createMissingLoyaltyTransaction(invoiceRefNumber) {
  try {
    console.log(`\n🔍 Creating Missing Loyalty Transaction for Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(80));

    // Find invoice
    const invoice = await SalesInvoice.findOne({
      where: { invoice_ref_number: invoiceRefNumber },
      include: [
        { model: Customer, as: 'customer' },
        { model: FinancialYear, as: 'financialYear' },
        { model: Currency, as: 'currency' }
      ]
    });

    if (!invoice) {
      console.error(`❌ Invoice ${invoiceRefNumber} not found`);
      return;
    }

    console.log(`✅ Invoice Found: ${invoiceRefNumber}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Subtotal: ${invoice.subtotal}`);

    const customer = invoice.customer;
    if (!customer) {
      console.error(`❌ Customer not found for invoice`);
      return;
    }

    console.log(`\n✅ Customer: ${customer.full_name}`);
    console.log(`   Loyalty Card Number: ${customer.loyalty_card_number || 'N/A'}`);
    console.log(`   Loyalty Card Config ID: ${customer.loyalty_card_config_id || 'N/A'}`);

    // Check if loyalty transaction already exists
    const existingTransaction = await LoyaltyTransaction.findOne({
      where: { sales_invoice_id: invoice.id }
    });

    if (existingTransaction) {
      console.log(`\n✅ Loyalty transaction already exists:`);
      console.log(`   Reference: ${existingTransaction.transaction_ref_number}`);
      console.log(`   Points: ${existingTransaction.points_amount}`);
      return;
    }

    // Check if customer has loyalty card
    if (!customer.loyalty_card_number || !customer.loyalty_card_config_id) {
      console.error(`\n❌ Customer does not have loyalty card configured`);
      console.log(`   Loyalty Card Number: ${customer.loyalty_card_number || 'MISSING'}`);
      console.log(`   Loyalty Card Config ID: ${customer.loyalty_card_config_id || 'MISSING'}`);
      return;
    }

    // Check if loyalty_card_configs table exists (required)
    const [loyaltyConfigTableCheck] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'loyalty_card_configs'
      );
    `, { type: sequelize.QueryTypes.SELECT });
    
    const loyaltyConfigTableExists = loyaltyConfigTableCheck?.exists || false;
    
    if (!loyaltyConfigTableExists) {
      console.error(`\n❌ loyalty_card_configs table does not exist`);
      return;
    }
    
    // Check if loyalty_cards table exists (optional)
    const [loyaltyCardsTableCheck] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'loyalty_cards'
      );
    `, { type: sequelize.QueryTypes.SELECT });
    
    const loyaltyCardsTableExists = loyaltyCardsTableCheck?.exists || false;

    const mockReq = createMockReq(invoice.approved_by || invoice.created_by, invoice.companyId);
    const transaction = await sequelize.transaction();

    try {
      // Get loyalty config
      const loyaltyConfig = await LoyaltyCardConfig.findByPk(customer.loyalty_card_config_id, { transaction });
      
      if (!loyaltyConfig) {
        throw new Error(`Loyalty config ${customer.loyalty_card_config_id} not found`);
      }

      console.log(`\n✅ Loyalty Config Found:`);
      console.log(`   Points per Currency Unit: ${loyaltyConfig.points_per_currency_unit || 'N/A'}`);
      console.log(`   Points Percentage: ${loyaltyConfig.points_percentage || 'N/A'}`);

      // Find or create loyalty card (only if loyalty_cards table exists)
      let loyaltyCardId = null;
      
      if (loyaltyCardsTableExists) {
        const { LoyaltyCard } = require('../server/models');
        let loyaltyCard = await LoyaltyCard.findOne({
          where: buildCompanyWhere(mockReq, { card_number: customer.loyalty_card_number }),
          transaction
        });

        if (!loyaltyCard) {
          console.log(`\n📝 Creating loyalty card ${customer.loyalty_card_number}...`);
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
            companyId: invoice.companyId,
            created_by: invoice.approved_by || invoice.created_by
          }, { transaction });
          console.log(`✅ Loyalty card created`);
        } else {
          console.log(`\n✅ Loyalty Card Found: ${loyaltyCard.card_number}`);
          console.log(`   Current Points: ${loyaltyCard.current_points || 0}`);
        }
        
        loyaltyCardId = loyaltyCard.id;
      } else {
        console.log(`\n⚠️  loyalty_cards table does not exist, creating transaction without card record`);
      }

      // Calculate points earned (based on config rules)
      // invoiceAmount is in invoice currency (could be USD, TZS, etc.)
      const invoiceAmount = parseFloat(invoice.subtotal || 0);
      
      // Get exchange rate from invoice
      const exchangeRate = parseFloat(invoice.exchange_rate || 1);
      
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

      console.log(`\n💰 Points Calculation:`);
      console.log(`   Invoice Amount (Invoice Currency): ${invoiceAmount}`);
      console.log(`   Exchange Rate: ${exchangeRate}`);
      console.log(`   Invoice Amount (System Currency): ${invoiceAmountInSystemCurrency}`);
      console.log(`   Points Earned: ${pointsEarned}`);

      if (pointsEarned > 0) {
        const financialYear = invoice.financialYear || await FinancialYear.findOne({
          where: buildCompanyWhere(mockReq, { isActive: true }),
          transaction
        });

        if (!financialYear) {
          throw new Error('Financial year not found');
        }

              // Create loyalty transaction (loyalty_card_id can be null if loyalty_cards table doesn't exist)
              const loyaltyTransaction = await LoyaltyTransaction.create({
                loyalty_card_id: loyaltyCardId, // null if loyalty_cards table doesn't exist
          transaction_type: 'earn',
          points_amount: pointsEarned,
          transaction_reference: invoice.invoice_ref_number,
          description: `Points earned from Sales Invoice ${invoice.invoice_ref_number}`,
          sales_invoice_id: invoice.id,
          customer_id: customer.id,
          store_id: invoice.store_id,
          loyalty_config_id: customer.loyalty_card_config_id,
          financial_year_id: financialYear.id,
          transaction_ref_number: `LT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          amount: invoiceAmount,
          currency_id: invoice.currency_id,
          exchange_rate: exchangeRate,
          status: 'completed',
          notes: `Earned ${pointsEarned} points from invoice ${invoice.invoice_ref_number}`,
          companyId: invoice.companyId,
          created_by: invoice.approved_by || invoice.created_by,
          updated_by: invoice.approved_by || invoice.created_by
        }, { transaction });

        console.log(`\n✅ Loyalty Transaction Created:`);
        console.log(`   Reference: ${loyaltyTransaction.transaction_ref_number}`);
        console.log(`   Points: ${pointsEarned}`);

        // Update loyalty card points (only if loyalty_cards table exists)
        if (loyaltyCardsTableExists && loyaltyCardId) {
          const { LoyaltyCard } = require('../server/models');
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
          where: buildCompanyWhere(mockReq, { id: customer.id }),
          transaction
        });

        console.log(`\n✅ Updated:`);
        console.log(`   Loyalty Card Points: +${pointsEarned}`);
        console.log(`   Customer Loyalty Points: +${pointsEarned}`);

        await transaction.commit();

        console.log(`\n${'='.repeat(80)}`);
        console.log(`✅ Loyalty transaction created successfully!`);
        console.log(`${'='.repeat(80)}\n`);

      } else {
        await transaction.rollback();
        console.log(`\n⚠️  No points earned (points calculation resulted in 0)`);
      }

    } catch (error) {
      await transaction.rollback();
      console.error(`\n❌ Error creating loyalty transaction:`, error.message);
      console.error(`Stack:`, error.stack);
      throw error;
    }

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sequelize.close();
  }
}

const invoiceRef = process.argv[2] || 'INV-20251110-0008';

createMissingLoyaltyTransaction(invoiceRef);

