require('dotenv').config();
const { createDatabaseConnection } = require('../config/database');
const { Op } = require('sequelize');
const { QueryTypes } = require('sequelize');

async function testInvoiceAccounts(invoiceRefNumber) {
  // Use local database - override DATABASE_URL if needed
  const localDbUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/easymauzo_pos';
  const sequelize = createDatabaseConnection(localDbUrl);
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log(`🔍 Testing Invoice: ${invoiceRefNumber}\n`);
    console.log('='.repeat(100));

    // 1. Get the invoice with all items and products using raw queries
    const invoiceResult = await sequelize.query(`
      SELECT * FROM sales_invoices WHERE "invoice_ref_number" = :invoiceRefNumber LIMIT 1
    `, {
      replacements: { invoiceRefNumber },
      type: QueryTypes.SELECT
    });

    if (!invoiceResult || invoiceResult.length === 0) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      await sequelize.close();
      process.exit(1);
    }

    const invoice = invoiceResult[0];

    // Get invoice items with products and categories
    const itemsResult = await sequelize.query(`
      SELECT 
        sii.*,
        p.id as product_id,
        p.name as product_name,
        p.code as product_code,
        p."product_type",
        p."income_account_id" as product_income_account_id,
        p."cogs_account_id" as product_cogs_account_id,
        p."asset_account_id" as product_asset_account_id,
        p."average_cost",
        pc.id as category_id,
        pc.name as category_name,
        pc."income_account_id" as category_income_account_id,
        pc."cogs_account_id" as category_cogs_account_id,
        pc."asset_account_id" as category_asset_account_id
      FROM sales_invoice_items sii
      LEFT JOIN products p ON sii."product_id" = p.id
      LEFT JOIN product_categories pc ON p."category_id" = pc.id
      WHERE sii."sales_invoice_id" = :invoiceId
      ORDER BY sii."created_at" ASC
    `, {
      replacements: { invoiceId: invoice.id },
      type: QueryTypes.SELECT
    });

    // Transform items to match expected structure
    const items = itemsResult.map(item => ({
      id: item.id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      product: item.product_id ? {
        id: item.product_id,
        name: item.product_name,
        code: item.product_code,
        product_type: item.product_type,
        income_account_id: item.product_income_account_id,
        cogs_account_id: item.product_cogs_account_id,
        asset_account_id: item.product_asset_account_id,
        average_cost: item.average_cost,
        category: item.category_id ? {
          id: item.category_id,
          name: item.category_name,
          income_account_id: item.category_income_account_id,
          cogs_account_id: item.category_cogs_account_id,
          asset_account_id: item.category_asset_account_id
        } : null
      } : null
    }));

    // Add items to invoice object
    invoice.items = items;

    if (!invoice) {
      console.log(`❌ Invoice not found: ${invoiceRefNumber}`);
      process.exit(1);
    }

    console.log('\n📄 INVOICE DETAILS:');
    console.log(`   Reference: ${invoice.invoice_ref_number}`);
    console.log(`   Status: ${invoice.status}`);
    console.log(`   Subtotal: ${parseFloat(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`   Discount: ${parseFloat(invoice.discount_amount || 0).toFixed(2)}`);
    console.log(`   Tax: ${parseFloat(invoice.tax_amount || 0).toFixed(2)}`);
    console.log(`   WHT: ${parseFloat(invoice.total_wht_amount || 0).toFixed(2)}`);
    console.log(`   Total: ${parseFloat(invoice.total_amount || 0).toFixed(2)}`);
    console.log(`   Account Receivable ID: ${invoice.account_receivable_id || 'N/A'}`);
    console.log(`   Discount Allowed Account ID: ${invoice.discount_allowed_account_id || 'N/A'}`);

    // 2. Analyze expected accounts from invoice items
    console.log('\n📦 EXPECTED ACCOUNTS FROM INVOICE ITEMS:');
    console.log('-'.repeat(100));

    const expectedAccounts = {
      income: new Map(), // accountId -> { account, amount, items }
      cogs: new Map(),   // accountId -> { account, amount, items }
      inventory: new Map(), // accountId -> { account, amount, items }
      receivable: null,
      discount: null,
      tax: new Map(),
      wht: new Map()
    };

    // Get receivable account
    if (invoice.account_receivable_id) {
      const receivableResult = await sequelize.query(`
        SELECT * FROM accounts WHERE id = :accountId LIMIT 1
      `, {
        replacements: { accountId: invoice.account_receivable_id },
        type: QueryTypes.SELECT
      });
      if (receivableResult && receivableResult.length > 0) {
        expectedAccounts.receivable = {
          account: receivableResult[0],
          amount: parseFloat(invoice.balance_amount || invoice.total_amount || 0)
        };
      }
    }

    // Get discount account
    if (invoice.discount_allowed_account_id && parseFloat(invoice.discount_amount || 0) > 0) {
      const discountResult = await sequelize.query(`
        SELECT * FROM accounts WHERE id = :accountId LIMIT 1
      `, {
        replacements: { accountId: invoice.discount_allowed_account_id },
        type: QueryTypes.SELECT
      });
      if (discountResult && discountResult.length > 0) {
        expectedAccounts.discount = {
          account: discountResult[0],
          amount: parseFloat(invoice.discount_amount || 0)
        };
      }
    }

    // Process each item
    invoice.items.forEach((item, index) => {
      const product = item.product;
      const category = product?.category;
      const quantity = parseFloat(item.quantity || 0);
      const unitPrice = parseFloat(item.unit_price || 0);
      const lineSubtotal = quantity * unitPrice;

      console.log(`\n   Item ${index + 1}: ${product?.name || 'Unknown Product'}`);
      console.log(`      Quantity: ${quantity}, Unit Price: ${unitPrice.toFixed(2)}, Subtotal: ${lineSubtotal.toFixed(2)}`);

      // Income Account
      const incomeAccountId = category?.income_account_id || product?.income_account_id;
      if (incomeAccountId) {
        if (!expectedAccounts.income.has(incomeAccountId)) {
          expectedAccounts.income.set(incomeAccountId, {
            accountId: incomeAccountId,
            amount: 0,
            items: []
          });
        }
        const incomeData = expectedAccounts.income.get(incomeAccountId);
        incomeData.amount += lineSubtotal;
        incomeData.items.push({ item, product, lineSubtotal });
        console.log(`      ✅ Income Account ID: ${incomeAccountId}`);
      } else {
        console.log(`      ❌ Income Account: NOT SET`);
      }

      // COGS Account (only for non-service products)
      if (product && product.product_type !== 'services') {
        const cogsAccountId = category?.cogs_account_id || product?.cogs_account_id;
        const averageCost = parseFloat(product?.average_cost || 0);
        const cogsAmount = quantity * averageCost;

        if (cogsAccountId && cogsAmount > 0) {
          if (!expectedAccounts.cogs.has(cogsAccountId)) {
            expectedAccounts.cogs.set(cogsAccountId, {
              accountId: cogsAccountId,
              amount: 0,
              items: []
            });
          }
          const cogsData = expectedAccounts.cogs.get(cogsAccountId);
          cogsData.amount += cogsAmount;
          cogsData.items.push({ item, product, cogsAmount });
          console.log(`      ✅ COGS Account ID: ${cogsAccountId}, Amount: ${cogsAmount.toFixed(2)}`);
        } else {
          console.log(`      ⚠️  COGS Account: ${cogsAccountId ? 'SET but amount is 0' : 'NOT SET'}`);
        }

        // Inventory Account (Asset Account)
        const inventoryAccountId = category?.asset_account_id || product?.asset_account_id;
        if (inventoryAccountId && cogsAmount > 0) {
          if (!expectedAccounts.inventory.has(inventoryAccountId)) {
            expectedAccounts.inventory.set(inventoryAccountId, {
              accountId: inventoryAccountId,
              amount: 0,
              items: []
            });
          }
          const inventoryData = expectedAccounts.inventory.get(inventoryAccountId);
          inventoryData.amount += cogsAmount;
          inventoryData.items.push({ item, product, cogsAmount });
          console.log(`      ✅ Inventory/Asset Account ID: ${inventoryAccountId}, Amount: ${cogsAmount.toFixed(2)}`);
        } else {
          console.log(`      ⚠️  Inventory/Asset Account: ${inventoryAccountId ? 'SET but amount is 0' : 'NOT SET'}`);
        }
      } else {
        console.log(`      ℹ️  Service Product - No COGS/Inventory accounts needed`);
      }
    });

    // 3. Get all GL entries for this invoice
    console.log('\n\n💰 ACTUAL GENERAL LEDGER ENTRIES:');
    console.log('-'.repeat(100));

    const glEntries = await sequelize.query(`
      SELECT * FROM general_ledger
      WHERE "reference_number" LIKE :pattern
        AND "companyId" = :companyId
      ORDER BY "account_nature" ASC, "account_name" ASC
    `, {
      replacements: { 
        pattern: `${invoiceRefNumber}%`,
        companyId: invoice.companyId
      },
      type: QueryTypes.SELECT
    });

    if (glEntries.length === 0) {
      console.log('❌ NO GENERAL LEDGER ENTRIES FOUND!');
      console.log('   This invoice may not have been approved yet, or GL entries were not created.');
      return;
    }

    console.log(`\n   Found ${glEntries.length} GL entries:\n`);

    const actualAccounts = {
      income: new Map(),
      cogs: new Map(),
      inventory: new Map(),
      receivable: null,
      discount: null,
      tax: new Map(),
      wht: new Map()
    };

    let totalDebit = 0;
    let totalCredit = 0;

    glEntries.forEach((entry, index) => {
      const nature = entry.account_nature?.toLowerCase();
      const amount = parseFloat(entry.amount || 0);
      
      if (nature === 'debit') {
        totalDebit += amount;
      } else if (nature === 'credit') {
        totalCredit += amount;
      }

      // Categorize by description
      const desc = (entry.description || '').toLowerCase();
      const accountId = entry.account_id;

      if (desc.includes('accounts receivable') || desc.includes('account receivable')) {
        actualAccounts.receivable = { account: entry, amount };
      } else if (desc.includes('discount allowed')) {
        actualAccounts.discount = { account: entry, amount };
      } else if (desc.includes('sales revenue') || desc.includes('revenue')) {
        if (!actualAccounts.income.has(accountId)) {
          actualAccounts.income.set(accountId, { account: entry, amount: 0 });
        }
        actualAccounts.income.get(accountId).amount += amount;
      } else if (desc.includes('cogs') || desc.includes('cost of sales')) {
        if (!actualAccounts.cogs.has(accountId)) {
          actualAccounts.cogs.set(accountId, { account: entry, amount: 0 });
        }
        actualAccounts.cogs.get(accountId).amount += amount;
      } else if (desc.includes('inventory')) {
        if (!actualAccounts.inventory.has(accountId)) {
          actualAccounts.inventory.set(accountId, { account: entry, amount: 0 });
        }
        actualAccounts.inventory.get(accountId).amount += amount;
      } else if (desc.includes('tax payable') || desc.includes('vat')) {
        if (!actualAccounts.tax.has(accountId)) {
          actualAccounts.tax.set(accountId, { account: entry, amount: 0 });
        }
        actualAccounts.tax.get(accountId).amount += amount;
      } else if (desc.includes('wht') || desc.includes('withholding')) {
        if (!actualAccounts.wht.has(accountId)) {
          actualAccounts.wht.set(accountId, { account: entry, amount: 0 });
        }
        actualAccounts.wht.get(accountId).amount += amount;
      }

      console.log(`   ${index + 1}. ${entry.account_nature?.toUpperCase() || 'N/A'}: ${entry.account_code || 'N/A'} - ${entry.account_name || 'N/A'}`);
      console.log(`      Amount: ${amount.toFixed(2)}`);
      console.log(`      Description: ${entry.description || 'N/A'}`);
      console.log(`      Account ID: ${accountId}`);
      console.log(`      Reference: ${entry.reference_number}`);
      console.log('');
    });

    console.log(`\n   Total Debit: ${totalDebit.toFixed(2)}`);
    console.log(`   Total Credit: ${totalCredit.toFixed(2)}`);
    console.log(`   Balance: ${(totalDebit - totalCredit).toFixed(2)} ${totalDebit === totalCredit ? '✅ BALANCED' : '❌ NOT BALANCED'}`);

    // 4. Compare Expected vs Actual
    console.log('\n\n📊 COMPARISON: EXPECTED vs ACTUAL');
    console.log('='.repeat(100));

    // Income Accounts
    console.log('\n💵 INCOME ACCOUNTS (Sales Revenue):');
    let incomeMatch = true;
    for (const [accountId, expected] of expectedAccounts.income.entries()) {
      const accountResult = await sequelize.query(`
        SELECT * FROM accounts WHERE id = :accountId LIMIT 1
      `, {
        replacements: { accountId },
        type: QueryTypes.SELECT
      });
      const account = accountResult && accountResult.length > 0 ? accountResult[0] : null;
      const actual = actualAccounts.income.get(accountId);
      const expectedAmount = expected.amount;
      const actualAmount = actual ? actual.amount : 0;
      const diff = Math.abs(expectedAmount - actualAmount);

      if (actual && diff < 0.01) {
        console.log(`   ✅ ${account?.code || accountId} - ${account?.name || 'Unknown'}: Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)}`);
      } else {
        incomeMatch = false;
        console.log(`   ❌ ${account?.code || accountId} - ${account?.name || 'Unknown'}: Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)} (Diff: ${diff.toFixed(2)})`);
      }
    }
    // Check for unexpected income accounts
    for (const [accountId, actual] of actualAccounts.income.entries()) {
      if (!expectedAccounts.income.has(accountId)) {
        const accountResult = await sequelize.query(`
          SELECT * FROM accounts WHERE id = :accountId LIMIT 1
        `, {
          replacements: { accountId },
          type: QueryTypes.SELECT
        });
        const account = accountResult && accountResult.length > 0 ? accountResult[0] : null;
        console.log(`   ⚠️  UNEXPECTED: ${account?.code || accountId} - ${account?.name || 'Unknown'}: ${actual.amount.toFixed(2)}`);
      }
    }
    if (expectedAccounts.income.size === 0) {
      console.log('   ⚠️  No income accounts expected (check product configuration)');
    }

    // COGS Accounts
    console.log('\n📉 COGS ACCOUNTS:');
    let cogsMatch = true;
    for (const [accountId, expected] of expectedAccounts.cogs.entries()) {
      const accountResult = await sequelize.query(`
        SELECT * FROM accounts WHERE id = :accountId LIMIT 1
      `, {
        replacements: { accountId },
        type: QueryTypes.SELECT
      });
      const account = accountResult && accountResult.length > 0 ? accountResult[0] : null;
      const actual = actualAccounts.cogs.get(accountId);
      const expectedAmount = expected.amount;
      const actualAmount = actual ? actual.amount : 0;
      const diff = Math.abs(expectedAmount - actualAmount);

      if (actual && diff < 0.01) {
        console.log(`   ✅ ${account?.code || accountId} - ${account?.name || 'Unknown'}: Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)}`);
      } else {
        cogsMatch = false;
        console.log(`   ❌ ${account?.code || accountId} - ${account?.name || 'Unknown'}: Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)} (Diff: ${diff.toFixed(2)})`);
      }
    }
    if (expectedAccounts.cogs.size === 0) {
      console.log('   ℹ️  No COGS accounts expected (all items are services or have no cost)');
    }

    // Inventory Accounts
    console.log('\n📦 INVENTORY/ASSET ACCOUNTS:');
    let inventoryMatch = true;
    for (const [accountId, expected] of expectedAccounts.inventory.entries()) {
      const accountResult = await sequelize.query(`
        SELECT * FROM accounts WHERE id = :accountId LIMIT 1
      `, {
        replacements: { accountId },
        type: QueryTypes.SELECT
      });
      const account = accountResult && accountResult.length > 0 ? accountResult[0] : null;
      const actual = actualAccounts.inventory.get(accountId);
      const expectedAmount = expected.amount;
      const actualAmount = actual ? actual.amount : 0;
      const diff = Math.abs(expectedAmount - actualAmount);

      if (actual && diff < 0.01) {
        console.log(`   ✅ ${account?.code || accountId} - ${account?.name || 'Unknown'}: Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)}`);
      } else {
        inventoryMatch = false;
        console.log(`   ❌ ${account?.code || accountId} - ${account?.name || 'Unknown'}: Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)} (Diff: ${diff.toFixed(2)})`);
      }
    }
    if (expectedAccounts.inventory.size === 0) {
      console.log('   ℹ️  No inventory accounts expected (all items are services or have no cost)');
    }

    // Receivable Account
    console.log('\n💳 ACCOUNTS RECEIVABLE:');
    if (expectedAccounts.receivable) {
      const expectedAmount = expectedAccounts.receivable.amount;
      const actualAmount = actualAccounts.receivable ? actualAccounts.receivable.amount : 0;
      const diff = Math.abs(expectedAmount - actualAmount);
      if (actualAccounts.receivable && diff < 0.01) {
        console.log(`   ✅ Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)}`);
      } else {
        console.log(`   ❌ Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)} (Diff: ${diff.toFixed(2)})`);
      }
    } else {
      console.log('   ⚠️  No receivable account expected');
    }

    // Discount Account
    console.log('\n🎁 DISCOUNT ALLOWED:');
    if (expectedAccounts.discount) {
      const expectedAmount = expectedAccounts.discount.amount;
      const actualAmount = actualAccounts.discount ? actualAccounts.discount.amount : 0;
      const diff = Math.abs(expectedAmount - actualAmount);
      if (actualAccounts.discount && diff < 0.01) {
        console.log(`   ✅ Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)}`);
      } else {
        console.log(`   ❌ Expected ${expectedAmount.toFixed(2)}, Actual ${actualAmount.toFixed(2)} (Diff: ${diff.toFixed(2)})`);
      }
    } else {
      console.log('   ℹ️  No discount account expected (no discount on invoice)');
    }

    // Summary
    console.log('\n\n📋 SUMMARY:');
    console.log('='.repeat(100));
    const allMatch = incomeMatch && cogsMatch && inventoryMatch && 
                     (expectedAccounts.receivable ? actualAccounts.receivable : true) &&
                     (expectedAccounts.discount ? actualAccounts.discount : true) &&
                     totalDebit === totalCredit;

    if (allMatch) {
      console.log('✅ ALL ACCOUNTS POSTED CORRECTLY!');
    } else {
      console.log('❌ SOME ACCOUNTS MISSING OR MISMATCHED!');
      console.log('\nIssues found:');
      if (!incomeMatch) console.log('   - Income accounts mismatch');
      if (!cogsMatch) console.log('   - COGS accounts mismatch');
      if (!inventoryMatch) console.log('   - Inventory accounts mismatch');
      if (expectedAccounts.receivable && !actualAccounts.receivable) console.log('   - Accounts Receivable missing');
      if (expectedAccounts.discount && !actualAccounts.discount) console.log('   - Discount Allowed missing');
      if (totalDebit !== totalCredit) console.log('   - General Ledger not balanced');
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await sequelize.close();
    process.exit(1);
  }
}

// Get invoice ref number from command line or use default
const invoiceRefNumber = process.argv[2] || 'INV-20251118-0001';
testInvoiceAccounts(invoiceRefNumber);

