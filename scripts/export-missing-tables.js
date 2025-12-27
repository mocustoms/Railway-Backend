/**
 * Export account_types and exchange_rates from source company
 * to add to initial-company-data.json
 */

const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');
const fs = require('fs');
const path = require('path');

const SOURCE_COMPANY_ID = '4e42f29c-4b11-48a3-a74a-ba4f26c138e3';
const OUTPUT_FILE = path.join(__dirname, '../data/missing-tables-data.json');

async function exportMissingTables() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    const result = {
      account_types: [],
      exchange_rates: []
    };

    // Export account_types
    console.log('📦 Exporting account_types...');
    const accountTypes = await sequelize.query(`
      SELECT 
        id,
        name,
        code,
        description,
        category,
        nature,
        is_active,
        created_by,
        updated_by,
        "companyId",
        created_at,
        updated_at
      FROM account_types
      WHERE "companyId" = :companyId
      ORDER BY code
    `, {
      replacements: { companyId: SOURCE_COMPANY_ID },
      type: QueryTypes.SELECT
    });

    console.log(`   Found ${accountTypes.length} account types`);
    result.account_types = accountTypes.map(at => ({
      name: at.name,
      code: at.code,
      description: at.description || null,
      category: at.category,
      nature: at.nature,
      is_active: at.is_active,
      _originalId: at.id // Store original ID for mapping
    }));

    // Export exchange_rates
    console.log('📦 Exporting exchange_rates...');
    const exchangeRates = await sequelize.query(`
      SELECT 
        id,
        from_currency_id,
        to_currency_id,
        rate,
        effective_date,
        is_active,
        created_by,
        updated_by,
        "companyId",
        created_at,
        updated_at
      FROM exchange_rates
      WHERE "companyId" = :companyId
      ORDER BY effective_date DESC
    `, {
      replacements: { companyId: SOURCE_COMPANY_ID },
      type: QueryTypes.SELECT
    });

    console.log(`   Found ${exchangeRates.length} exchange rates`);
    result.exchange_rates = exchangeRates.map(er => ({
      from_currency_id: er.from_currency_id, // Will be mapped to new currency ID
      to_currency_id: er.to_currency_id, // Will be mapped to new currency ID
      rate: er.rate.toString(),
      effective_date: er.effective_date,
      is_active: er.is_active,
      _originalId: er.id // Store original ID for mapping
    }));

    // Write to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
    console.log(`\n✅ Exported data to: ${OUTPUT_FILE}`);
    console.log(`\n📊 Summary:`);
    console.log(`   Account Types: ${result.account_types.length}`);
    console.log(`   Exchange Rates: ${result.exchange_rates.length}`);

    // Show account types
    console.log(`\n📋 Account Types:`);
    result.account_types.forEach((at, idx) => {
      console.log(`   ${idx + 1}. ${at.name} (${at.code}) - ${at.category}/${at.nature}`);
    });

    // Show exchange rates
    if (result.exchange_rates.length > 0) {
      console.log(`\n💱 Exchange Rates:`);
      result.exchange_rates.forEach((er, idx) => {
        console.log(`   ${idx + 1}. Rate: ${er.rate} (from: ${er.from_currency_id.substring(0, 8)}..., to: ${er.to_currency_id.substring(0, 8)}...)`);
      });
    }

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

exportMissingTables();

