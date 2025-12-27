#!/usr/bin/env node

/**
 * Direct Database Query: Read Journal Entry Related Tables
 * Queries accounts, currencies, financial_years, journal_entries, and journal_entry_lines
 */

const { sequelize } = require('../server/models');
const { QueryTypes } = require('sequelize');

async function readJournalEntryTables() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    console.log('='.repeat(80));
    console.log('📊 JOURNAL ENTRY RELATED TABLES');
    console.log('='.repeat(80));
    console.log('');

    // 1. Check Financial Years
    console.log('📅 FINANCIAL YEARS');
    console.log('-'.repeat(80));
    const financialYears = await sequelize.query(`
      SELECT 
        id,
        name,
        "startDate",
        "endDate",
        "isCurrent",
        "isActive",
        "isClosed",
        "companyId"
      FROM financial_years
      ORDER BY "startDate" DESC
      LIMIT 10
    `, { type: QueryTypes.SELECT });

    if (financialYears.length > 0) {
      console.log(`Found ${financialYears.length} financial year(s):\n`);
      financialYears.forEach((fy, idx) => {
        console.log(`  ${idx + 1}. ${fy.name}`);
        console.log(`     ID: ${fy.id}`);
        console.log(`     Period: ${fy.startDate} to ${fy.endDate}`);
        console.log(`     Current: ${fy.isCurrent ? 'Yes' : 'No'} | Active: ${fy.isActive ? 'Yes' : 'No'} | Closed: ${fy.isClosed ? 'Yes' : 'No'}`);
        console.log(`     Company ID: ${fy.companyId}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  No financial years found\n');
    }

    // 2. Check Accounts
    console.log('💼 ACCOUNTS');
    console.log('-'.repeat(80));
    const accounts = await sequelize.query(`
      SELECT 
        id,
        code,
        name,
        type,
        nature,
        status,
        "accountTypeId",
        "companyId"
      FROM accounts
      WHERE status = 'active'
      ORDER BY code ASC
      LIMIT 20
    `, { type: QueryTypes.SELECT });

    if (accounts.length > 0) {
      console.log(`Found ${accounts.length} active account(s) (showing first 20):\n`);
      accounts.forEach((acc, idx) => {
        console.log(`  ${idx + 1}. [${acc.code}] ${acc.name}`);
        console.log(`     ID: ${acc.id}`);
        console.log(`     Type: ${acc.type} | Nature: ${acc.nature} | Status: ${acc.status}`);
        console.log(`     Company ID: ${acc.companyId}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  No active accounts found\n');
    }

    // Get total count
    const [accountCount] = await sequelize.query(`
      SELECT COUNT(*) as count FROM accounts WHERE status = 'active'
    `, { type: QueryTypes.SELECT });
    console.log(`  Total active accounts: ${accountCount.count}\n`);

    // 3. Check Currencies
    console.log('💱 CURRENCIES');
    console.log('-'.repeat(80));
    const currencies = await sequelize.query(`
      SELECT 
        id,
        code,
        name,
        symbol,
        is_default,
        is_active,
        "companyId"
      FROM currencies
      WHERE is_active = true
      ORDER BY code ASC
    `, { type: QueryTypes.SELECT });

    if (currencies.length > 0) {
      console.log(`Found ${currencies.length} active currency/currencies:\n`);
      currencies.forEach((curr, idx) => {
        console.log(`  ${idx + 1}. [${curr.code}] ${curr.name} ${curr.symbol || ''}`);
        console.log(`     ID: ${curr.id}`);
        console.log(`     Default: ${curr.is_default ? 'Yes' : 'No'} | Active: ${curr.is_active ? 'Yes' : 'No'}`);
        console.log(`     Company ID: ${curr.companyId}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  No active currencies found\n');
    }

    // 4. Check Journal Entries
    console.log('📝 JOURNAL ENTRIES');
    console.log('-'.repeat(80));
    const journalEntries = await sequelize.query(`
      SELECT 
        id,
        reference_number,
        entry_date,
        description,
        financial_year_id,
        total_debit,
        total_credit,
        is_posted,
        posted_at,
        posted_by,
        created_by,
        "companyId",
        created_at,
        updated_at
      FROM journal_entries
      ORDER BY created_at DESC
      LIMIT 10
    `, { type: QueryTypes.SELECT });

    if (journalEntries.length > 0) {
      console.log(`Found ${journalEntries.length} journal entry/entries (showing last 10):\n`);
      journalEntries.forEach((entry, idx) => {
        console.log(`  ${idx + 1}. ${entry.reference_number}`);
        console.log(`     ID: ${entry.id}`);
        console.log(`     Date: ${entry.entry_date}`);
        console.log(`     Description: ${entry.description || '(none)'}`);
        console.log(`     Financial Year ID: ${entry.financial_year_id}`);
        console.log(`     Debit: ${entry.total_debit} | Credit: ${entry.total_credit}`);
        console.log(`     Posted: ${entry.is_posted ? 'Yes' : 'No'}`);
        if (entry.is_posted) {
          console.log(`     Posted At: ${entry.posted_at}`);
        }
        console.log(`     Company ID: ${entry.companyId}`);
        console.log(`     Created: ${entry.created_at}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  No journal entries found\n');
    }

    // Get total count
    const [entryCount] = await sequelize.query(`
      SELECT COUNT(*) as count FROM journal_entries
    `, { type: QueryTypes.SELECT });
    console.log(`  Total journal entries: ${entryCount.count}\n`);

    // 5. Check Journal Entry Lines
    console.log('📋 JOURNAL ENTRY LINES');
    console.log('-'.repeat(80));
    const journalEntryLines = await sequelize.query(`
      SELECT 
        jel.id,
        jel.journal_entry_id,
        je.reference_number,
        jel.account_id,
        jel.type,
        jel.amount,
        jel.original_amount,
        jel.equivalent_amount,
        jel.currency_id,
        jel.exchange_rate,
        jel.description,
        jel.line_number,
        jel."companyId"
      FROM journal_entry_lines jel
      LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id
      ORDER BY jel.created_at DESC
      LIMIT 20
    `, { type: QueryTypes.SELECT });

    if (journalEntryLines.length > 0) {
      console.log(`Found ${journalEntryLines.length} journal entry line(s) (showing last 20):\n`);
      journalEntryLines.forEach((line, idx) => {
        console.log(`  ${idx + 1}. Line ${line.line_number} - ${line.type.toUpperCase()}`);
        console.log(`     ID: ${line.id}`);
        console.log(`     Journal Entry: ${line.reference_number || line.journal_entry_id}`);
        console.log(`     Account ID: ${line.account_id}`);
        console.log(`     Amount: ${line.amount}`);
        if (line.original_amount) {
          console.log(`     Original Amount: ${line.original_amount} (Currency: ${line.currency_id || 'N/A'})`);
          console.log(`     Exchange Rate: ${line.exchange_rate || 'N/A'}`);
          console.log(`     Equivalent Amount: ${line.equivalent_amount || 'N/A'}`);
        }
        console.log(`     Description: ${line.description || '(none)'}`);
        console.log(`     Company ID: ${line.companyId}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  No journal entry lines found\n');
    }

    // Get total count
    const [lineCount] = await sequelize.query(`
      SELECT COUNT(*) as count FROM journal_entry_lines
    `, { type: QueryTypes.SELECT });
    console.log(`  Total journal entry lines: ${lineCount.count}\n`);

    // 6. Summary Statistics
    console.log('📊 SUMMARY STATISTICS');
    console.log('-'.repeat(80));
    
    const stats = await sequelize.query(`
      SELECT 
        (SELECT COUNT(*) FROM financial_years WHERE "isActive" = true) as active_financial_years,
        (SELECT COUNT(*) FROM financial_years WHERE "isCurrent" = true AND "isActive" = true) as current_financial_years,
        (SELECT COUNT(*) FROM accounts WHERE status = 'active') as active_accounts,
        (SELECT COUNT(*) FROM currencies WHERE is_active = true) as active_currencies,
        (SELECT COUNT(*) FROM journal_entries) as total_journal_entries,
        (SELECT COUNT(*) FROM journal_entries WHERE is_posted = true) as posted_journal_entries,
        (SELECT COUNT(*) FROM journal_entries WHERE is_posted = false) as unposted_journal_entries,
        (SELECT COUNT(*) FROM journal_entry_lines) as total_journal_entry_lines
    `, { type: QueryTypes.SELECT });

    const summary = stats[0];
    console.log(`  Active Financial Years: ${summary.active_financial_years}`);
    console.log(`  Current Financial Year(s): ${summary.current_financial_years}`);
    console.log(`  Active Accounts: ${summary.active_accounts}`);
    console.log(`  Active Currencies: ${summary.active_currencies}`);
    console.log(`  Total Journal Entries: ${summary.total_journal_entries}`);
    console.log(`    - Posted: ${summary.posted_journal_entries}`);
    console.log(`    - Unposted: ${summary.unposted_journal_entries}`);
    console.log(`  Total Journal Entry Lines: ${summary.total_journal_entry_lines}`);
    console.log('');

    // 7. Check for any data issues
    console.log('🔍 DATA VALIDATION');
    console.log('-'.repeat(80));
    
    // Check for journal entries without financial year
    const [orphanEntries] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM journal_entries je
      LEFT JOIN financial_years fy ON je.financial_year_id = fy.id
      WHERE fy.id IS NULL
    `, { type: QueryTypes.SELECT });
    
    if (orphanEntries.count > 0) {
      console.log(`  ⚠️  Found ${orphanEntries.count} journal entry/entries with invalid financial year`);
    } else {
      console.log('  ✅ All journal entries have valid financial years');
    }

    // Check for journal entry lines without accounts
    const [orphanLines] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM journal_entry_lines jel
      LEFT JOIN accounts a ON jel.account_id = a.id
      WHERE a.id IS NULL
    `, { type: QueryTypes.SELECT });
    
    if (orphanLines.count > 0) {
      console.log(`  ⚠️  Found ${orphanLines.count} journal entry line(s) with invalid account`);
    } else {
      console.log('  ✅ All journal entry lines have valid accounts');
    }

    // Check for unbalanced journal entries
    const [unbalanced] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM journal_entries
      WHERE ABS(total_debit - total_credit) > 0.01
    `, { type: QueryTypes.SELECT });
    
    if (unbalanced.count > 0) {
      console.log(`  ⚠️  Found ${unbalanced.count} unbalanced journal entry/entries (debit ≠ credit)`);
    } else {
      console.log('  ✅ All journal entries are balanced');
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Database query completed successfully');
    console.log('='.repeat(80));

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await sequelize.close();
    process.exit(1);
  }
}

// Run the script
readJournalEntryTables();

