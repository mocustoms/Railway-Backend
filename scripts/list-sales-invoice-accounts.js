const sequelize = require('../config/database');
const { Account, AccountType } = require('../server/models');

async function listSalesInvoiceAccounts() {
  try {
    console.log('\n📊 ACCOUNTS USED IN SALES INVOICE MODULE\n');
    console.log('='.repeat(80));

    console.log('\n📋 SUMMARY OF ALL ACCOUNTS CAPTURED:\n');
    
    console.log('When a Sales Invoice is approved, the following accounts are used:\n');
    
    console.log('1️⃣  PER INVOICE ITEM (for each product sold):');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ a) COGS Account (Cost of Goods Sold)                        │');
    console.log('   │    • Source: Product Category → cogs_account_id            │');
    console.log('   │      OR Product → cogs_account_id (overrides category)      │');
    console.log('   │    • Type: EXPENSE                                           │');
    console.log('   │    • Nature: DEBIT                                          │');
    console.log('   │    • Amount: quantity × average_cost                         │');
    console.log('   │    • Purpose: Records the cost of inventory sold            │');
    console.log('   └─────────────────────────────────────────────────────────────┘');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ b) Inventory Account (Asset Account)                         │');
    console.log('   │    • Source: Product Category → asset_account_id            │');
    console.log('   │      OR Product → asset_account_id (overrides category)     │');
    console.log('   │    • Type: ASSET                                            │');
    console.log('   │    • Nature: CREDIT                                         │');
    console.log('   │    • Amount: quantity × average_cost                         │');
    console.log('   │    • Purpose: Reduces inventory value when items are sold   │');
    console.log('   └─────────────────────────────────────────────────────────────┘');
    
    console.log('\n2️⃣  FOR INVOICE TOTALS:');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ a) Accounts Receivable Account                             │');
    console.log('   │    • Source: Customer → default_receivable_account_id        │');
    console.log('   │      OR Invoice → account_receivable_id (fallback)          │');
    console.log('   │    • Type: ASSET                                            │');
    console.log('   │    • Nature: DEBIT                                          │');
    console.log('   │    • Amount: invoice balance_amount (unpaid amount)         │');
    console.log('   │    • Purpose: Records money owed by customer                │');
    console.log('   └─────────────────────────────────────────────────────────────┘');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ b) Income Account (Sales Revenue)                           │');
    console.log('   │    • Source: Product Category → income_account_id          │');
    console.log('   │      OR Product → income_account_id (overrides category)   │');
    console.log('   │    • Type: REVENUE                                          │');
    console.log('   │    • Nature: CREDIT                                         │');
    console.log('   │    • Amount: invoice subtotal (before tax)                  │');
    console.log('   │    • Purpose: Records sales revenue earned                  │');
    console.log('   └─────────────────────────────────────────────────────────────┘');
    
    console.log('\n3️⃣  OPTIONAL ACCOUNTS (if applicable):');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ a) Discount Allowed Account                                  │');
    console.log('   │    • Source: Invoice → discount_allowed_account_id           │');
    console.log('   │    • Type: EXPENSE                                          │');
    console.log('   │    • Nature: DEBIT                                          │');
    console.log('   │    • Amount: invoice discount_amount                        │');
    console.log('   │    • Purpose: Records discounts given to customers         │');
    console.log('   │    • Condition: Only if discount_amount > 0                 │');
    console.log('   └─────────────────────────────────────────────────────────────┘');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ b) Tax Payable Account                                       │');
    console.log('   │    • Source: Searched by code "TAX_PAYABLE"                  │');
    console.log('   │    • Type: LIABILITY                                         │');
    console.log('   │    • Nature: CREDIT                                         │');
    console.log('   │    • Amount: invoice tax_amount                             │');
    console.log('   │    • Purpose: Records tax collected from customer           │');
    console.log('   │    • Condition: Only if tax_amount > 0                     │');
    console.log('   └─────────────────────────────────────────────────────────────┘');
    console.log('   ┌─────────────────────────────────────────────────────────────┐');
    console.log('   │ c) WHT Receivable Account (Withholding Tax)                  │');
    console.log('   │    • Source: Searched by code/name containing "WHT"          │');
    console.log('   │    • Type: ASSET                                             │');
    console.log('   │    • Nature: DEBIT                                          │');
    console.log('   │    • Amount: invoice total_wht_amount                       │');
    console.log('   │    • Purpose: Records withholding tax receivable            │');
    console.log('   │    • Condition: Only if total_wht_amount > 0                │');
    console.log('   └─────────────────────────────────────────────────────────────┘');

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 ACCOUNT HIERARCHY (Priority Order):\n');
    
    console.log('For COGS Account:');
    console.log('   1. Product → cogs_account_id (if set)');
    console.log('   2. Product Category → cogs_account_id (if product doesn\'t have one)');
    console.log('   3. ❌ Error if neither is set');
    
    console.log('\nFor Inventory Account:');
    console.log('   1. Product → asset_account_id (if set)');
    console.log('   2. Product Category → asset_account_id (if product doesn\'t have one)');
    console.log('   3. ❌ Error if neither is set');
    
    console.log('\nFor Income Account:');
    console.log('   1. Product → income_account_id (if set)');
    console.log('   2. Product Category → income_account_id (if product doesn\'t have one)');
    console.log('   3. ❌ Error if neither is set');
    
    console.log('\nFor Accounts Receivable:');
    console.log('   1. Customer → default_receivable_account_id (if set)');
    console.log('   2. Invoice → account_receivable_id (fallback)');
    console.log('   3. ❌ Error if neither is set');
    
    console.log('\nFor Discount Allowed:');
    console.log('   1. Invoice → discount_allowed_account_id (if set)');
    console.log('   2. ⚠️  Skipped if not set (no error, just no discount entry)');
    
    console.log('\nFor Tax Payable:');
    console.log('   1. Account with code = "TAX_PAYABLE"');
    console.log('   2. ⚠️  Skipped if not found (no error, just no tax entry)');
    
    console.log('\nFor WHT Receivable:');
    console.log('   1. Account with code/name containing "WHT" or "Withholding"');
    console.log('   2. ⚠️  Warning logged if not found (no error, just no WHT entry)');

    console.log('\n' + '='.repeat(80));
    console.log('\n💡 KEY POINTS:\n');
    console.log('   • All accounts are required EXCEPT: Discount, Tax, and WHT');
    console.log('   • Product-level accounts override category-level accounts');
    console.log('   • All amounts are converted between invoice currency and system currency');
    console.log('   • All entries are linked via general_ledger_id for grouping');
    console.log('   • Missing required accounts will cause invoice approval to fail');
    
    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sequelize.close();
  }
}

listSalesInvoiceAccounts();

