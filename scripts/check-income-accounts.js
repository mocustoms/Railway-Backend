const sequelize = require('../config/database');
const { Account, AccountType, Product, ProductCategory } = require('../server/models');

async function checkIncomeAccounts() {
  try {
    console.log('\n📊 Checking Income Accounts in System\n');
    console.log('='.repeat(80));

    // Get all accounts with type REVENUE (the enum value is REVENUE, not INCOME)
    const revenueAccounts = await Account.findAll({
      include: [{
        model: AccountType,
        as: 'accountType',
        where: {
          category: 'REVENUE'
        }
      }],
      order: [['name', 'ASC']]
    });

    console.log(`\n✅ Found ${revenueAccounts.length} Revenue/Income Account(s):\n`);
    
    if (revenueAccounts.length === 0) {
      console.log('⚠️  No revenue/income accounts found in the system');
      console.log('   You need to create accounts with category "REVENUE" or "INCOME"');
    } else {
      revenueAccounts.forEach((account, index) => {
        console.log(`${index + 1}. ${account.name} (${account.code})`);
        console.log(`   ID: ${account.id}`);
        console.log(`   Type: ${account.accountType?.name || 'N/A'} (${account.accountType?.category || 'N/A'})`);
        console.log(`   Nature: ${account.accountType?.nature || 'N/A'}`);
        console.log(`   Status: ${account.status || 'N/A'}`);
        console.log('');
      });
    }

    // Check which product categories use income accounts
    console.log('\n📦 Product Categories with Income Accounts:\n');
    const categoriesWithIncome = await ProductCategory.findAll({
      order: [['name', 'ASC']]
    });

    // Load income accounts separately
    const categoryIncomeAccountIds = categoriesWithIncome
      .filter(cat => cat.income_account_id)
      .map(cat => cat.income_account_id);
    
    const incomeAccountsMap = {};
    if (categoryIncomeAccountIds.length > 0) {
      const accounts = await Account.findAll({
        where: { id: categoryIncomeAccountIds },
        include: [{ model: AccountType, as: 'accountType' }]
      });
      accounts.forEach(acc => {
        incomeAccountsMap[acc.id] = acc;
      });
    }

    const categoriesWithIncomeAccounts = categoriesWithIncome.filter(cat => cat.income_account_id);
    const categoriesWithoutIncomeAccounts = categoriesWithIncome.filter(cat => !cat.income_account_id);

    console.log(`✅ Categories WITH income accounts: ${categoriesWithIncomeAccounts.length}`);
    categoriesWithIncomeAccounts.forEach((cat, index) => {
      const incomeAccount = incomeAccountsMap[cat.income_account_id];
      console.log(`   ${index + 1}. ${cat.name} (${cat.code})`);
      console.log(`      Income Account: ${incomeAccount?.name || 'NOT FOUND'} (${incomeAccount?.code || 'N/A'})`);
    });

    if (categoriesWithoutIncomeAccounts.length > 0) {
      console.log(`\n⚠️  Categories WITHOUT income accounts: ${categoriesWithoutIncomeAccounts.length}`);
      categoriesWithoutIncomeAccounts.forEach((cat, index) => {
        console.log(`   ${index + 1}. ${cat.name} (${cat.code})`);
      });
    }

    // Check which products use income accounts (override category)
    console.log('\n\n📦 Products with Income Accounts (overriding category):\n');
    const productsWithIncome = await Product.findAll({
      where: {
        income_account_id: { [sequelize.Sequelize.Op.ne]: null }
      },
      limit: 20, // Limit to first 20
      order: [['name', 'ASC']]
    });

    // Load product income accounts
    const productIncomeAccountIds = productsWithIncome
      .map(prod => prod.income_account_id)
      .filter(id => id);
    
    const productIncomeAccountsMap = {};
    if (productIncomeAccountIds.length > 0) {
      const accounts = await Account.findAll({
        where: { id: productIncomeAccountIds },
        include: [{ model: AccountType, as: 'accountType' }]
      });
      accounts.forEach(acc => {
        productIncomeAccountsMap[acc.id] = acc;
      });
    }

    if (productsWithIncome.length > 0) {
      console.log(`✅ Found ${productsWithIncome.length} product(s) with income accounts (showing first 20):`);
      productsWithIncome.forEach((product, index) => {
        const incomeAccount = productIncomeAccountsMap[product.income_account_id];
        console.log(`   ${index + 1}. ${product.name} (${product.code})`);
        console.log(`      Income Account: ${incomeAccount?.name || 'NOT FOUND'} (${incomeAccount?.code || 'N/A'})`);
      });
    } else {
      console.log('ℹ️  No products have individual income accounts set (using category defaults)');
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('\n📋 SUMMARY:\n');
    console.log(`   Total Revenue/Income Accounts: ${revenueAccounts.length}`);
    console.log(`   Categories with Income Accounts: ${categoriesWithIncomeAccounts.length}`);
    console.log(`   Categories without Income Accounts: ${categoriesWithoutIncomeAccounts.length}`);
    console.log(`   Products with Individual Income Accounts: ${productsWithIncome.length}`);
    
    if (categoriesWithoutIncomeAccounts.length > 0) {
      console.log('\n⚠️  WARNING: Some categories are missing income accounts!');
      console.log('   Sales invoices for products in these categories will fail to approve.');
      console.log('   Please set income_account_id on these categories.');
    }

    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sequelize.close();
  }
}

checkIncomeAccounts();

