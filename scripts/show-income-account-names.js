const sequelize = require('../config/database');
const { Account, AccountType, ProductCategory } = require('../server/models');

async function showIncomeAccountNames() {
  try {
    console.log('\n📊 INCOME ACCOUNTS CONFIGURED IN YOUR SYSTEM\n');
    console.log('='.repeat(80));

    // Get all revenue accounts
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

    console.log(`\n✅ All Revenue/Income Accounts Available (${revenueAccounts.length} total):\n`);
    revenueAccounts.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.name} (Code: ${account.code})`);
      console.log(`      ID: ${account.id}`);
    });

    // Check which ones are actually being used by categories
    console.log('\n\n📦 Income Accounts Currently Used by Product Categories:\n');
    
    const categories = await ProductCategory.findAll({
      where: {
        income_account_id: { [sequelize.Sequelize.Op.ne]: null }
      },
      order: [['name', 'ASC']]
    });

    const accountIds = [...new Set(categories.map(cat => cat.income_account_id).filter(id => id))];
    
    if (accountIds.length > 0) {
      const usedAccounts = await Account.findAll({
        where: { id: accountIds },
        include: [{ model: AccountType, as: 'accountType' }],
        order: [['name', 'ASC']]
      });

      console.log(`✅ ${usedAccounts.length} Income Account(s) are currently in use:\n`);
      
      usedAccounts.forEach((account, index) => {
        const categoriesUsingThis = categories.filter(cat => cat.income_account_id === account.id);
        console.log(`   ${index + 1}. "${account.name}" (Code: ${account.code})`);
        console.log(`      Used by ${categoriesUsingThis.length} category/categories:`);
        categoriesUsingThis.slice(0, 5).forEach(cat => {
          console.log(`         - ${cat.name} (${cat.code})`);
        });
        if (categoriesUsingThis.length > 5) {
          console.log(`         ... and ${categoriesUsingThis.length - 5} more`);
        }
        console.log('');
      });
    }

    // Most commonly used
    const accountUsage = {};
    categories.forEach(cat => {
      if (cat.income_account_id) {
        accountUsage[cat.income_account_id] = (accountUsage[cat.income_account_id] || 0) + 1;
      }
    });

    const sortedUsage = Object.entries(accountUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (sortedUsage.length > 0) {
      console.log('\n🏆 MOST COMMONLY USED INCOME ACCOUNTS:\n');
      for (const [accountId, count] of sortedUsage) {
        const account = await Account.findByPk(accountId, {
          include: [{ model: AccountType, as: 'accountType' }]
        });
        if (account) {
          console.log(`   • "${account.name}" (${account.code}) - Used by ${count} categories`);
        }
      }
    }

    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sequelize.close();
  }
}

showIncomeAccountNames();

