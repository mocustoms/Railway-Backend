#!/usr/bin/env node

/**
 * Upload Costing Methods from Local Database to Railway
 * 
 * This script:
 * 1. Exports all costing methods from local database
 * 2. Imports them to Railway database (skipping duplicates)
 * 
 * Usage:
 *   node scripts/upload-costing-methods-to-railway.js [RAILWAY_DATABASE_URL]
 * 
 * If RAILWAY_DATABASE_URL is not provided, it will use:
 * - RAILWAY_DATABASE_URL environment variable
 * - DATABASE_URL environment variable (if it contains 'railway')
 * - Default Railway URL from config
 */

require('dotenv').config();
const sequelize = require('../config/database');
const { getRailwayDatabaseUrl, createRailwaySequelize } = require('../config/railway-db');
const { QueryTypes } = require('sequelize');

async function uploadCostingMethodsToRailway() {
  const railwayDbUrl = process.argv[2];
  
  // Get Railway database URL
  const railwayUrl = getRailwayDatabaseUrl(railwayDbUrl);
  const railwaySequelize = createRailwaySequelize(railwayUrl);
  const transaction = await railwaySequelize.transaction();

  try {
    console.log('\n🔄 Uploading Costing Methods to Railway...');
    console.log('='.repeat(80));

    // Connect to local database
    await sequelize.authenticate();
    console.log('✅ Connected to LOCAL database');

    // Connect to Railway database
    await railwaySequelize.authenticate();
    console.log('✅ Connected to RAILWAY database\n');

    // Step 1: Export costing methods from local database
    console.log('📥 Exporting costing methods from local database...');
    const localCostingMethods = await sequelize.query(
      `SELECT 
        id,
        code,
        name,
        description,
        is_active,
        "companyId",
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM costing_methods
      ORDER BY code ASC`,
      {
        type: QueryTypes.SELECT
      }
    );

    if (!localCostingMethods || localCostingMethods.length === 0) {
      console.log('⚠️  No costing methods found in local database');
      await transaction.commit();
      return;
    }

    console.log(`✅ Found ${localCostingMethods.length} costing method(s) in local database\n`);

    // Step 2: Check existing costing methods in Railway
    console.log('🔍 Checking existing costing methods in Railway...');
    const existingMethods = await railwaySequelize.query(
      `SELECT code FROM costing_methods`,
      {
        transaction,
        type: QueryTypes.SELECT
      }
    );

    const existingCodes = new Set(
      Array.isArray(existingMethods) && existingMethods.length > 0
        ? existingMethods.map(m => m.code)
        : []
    );

    console.log(`ℹ️  Found ${existingCodes.size} existing costing method(s) in Railway\n`);

    // Step 3: Filter out duplicates and prepare for insertion
    const methodsToInsert = localCostingMethods.filter(method => !existingCodes.has(method.code));
    
    if (methodsToInsert.length === 0) {
      console.log('ℹ️  All costing methods already exist in Railway. Nothing to upload.\n');
      await transaction.commit();
      return;
    }

    console.log(`📤 Uploading ${methodsToInsert.length} new costing method(s)...\n`);

    // Step 3.5: Get list of existing companies in Railway (for companyId validation)
    console.log('🔍 Checking existing companies in Railway...');
    const railwayCompanies = await railwaySequelize.query(
      `SELECT id FROM "Company"`,
      {
        transaction,
        type: QueryTypes.SELECT
      }
    );

    const railwayCompanyIds = new Set(
      Array.isArray(railwayCompanies) && railwayCompanies.length > 0
        ? railwayCompanies.map(c => c.id)
        : []
    );

    console.log(`ℹ️  Found ${railwayCompanyIds.size} company(ies) in Railway\n`);

    // Step 4: Insert costing methods into Railway
    let successCount = 0;
    let skipCount = 0;

    for (const method of methodsToInsert) {
      try {
        // Check again if it exists (in case of race condition)
        const checkExisting = await railwaySequelize.query(
          `SELECT id FROM costing_methods WHERE code = :code LIMIT 1`,
          {
            replacements: { code: method.code },
            transaction,
            type: QueryTypes.SELECT
          }
        );

        if (Array.isArray(checkExisting) && checkExisting.length > 0) {
          console.log(`⏭️  Skipping ${method.code} (${method.name}) - already exists`);
          skipCount++;
          continue;
        }

        // Validate companyId - if it doesn't exist in Railway, use first available company
        // (Railway may still have NOT NULL constraint on companyId)
        let validCompanyId = method.companyId || null;
        if (validCompanyId && !railwayCompanyIds.has(validCompanyId)) {
          // If company doesn't exist, use first available company in Railway
          if (railwayCompanyIds.size > 0) {
            const firstCompanyId = Array.from(railwayCompanyIds)[0];
            console.log(`⚠️  Company ${validCompanyId.substring(0, 8)}... not found in Railway for ${method.code}. Using first available company: ${firstCompanyId.substring(0, 8)}...`);
            validCompanyId = firstCompanyId;
          } else {
            // If no companies exist, try null (may fail if NOT NULL constraint exists)
            console.log(`⚠️  No companies found in Railway for ${method.code}. Attempting to set as global (null).`);
            validCompanyId = null;
          }
        } else if (!validCompanyId && railwayCompanyIds.size > 0) {
          // If method has no companyId but Railway requires it, use first available company
          const firstCompanyId = Array.from(railwayCompanyIds)[0];
          console.log(`ℹ️  ${method.code} has no companyId. Using first available company: ${firstCompanyId.substring(0, 8)}...`);
          validCompanyId = firstCompanyId;
        }

        // Insert the costing method
        await railwaySequelize.query(
          `INSERT INTO costing_methods (
            id,
            code,
            name,
            description,
            is_active,
            "companyId",
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES (
            :id,
            :code,
            :name,
            :description,
            :is_active,
            :companyId,
            :created_by,
            :updated_by,
            :created_at,
            :updated_at
          )`,
          {
            replacements: {
              id: method.id,
              code: method.code,
              name: method.name,
              description: method.description || null,
              is_active: method.is_active !== undefined ? method.is_active : true,
              companyId: validCompanyId,
              created_by: method.created_by || null,
              updated_by: method.updated_by || null,
              created_at: method.created_at || new Date(),
              updated_at: method.updated_at || new Date()
            },
            transaction
          }
        );

        const scopeText = validCompanyId ? `(company: ${validCompanyId.substring(0, 8)}...)` : '(global)';
        console.log(`✅ Uploaded: ${method.code} - ${method.name} ${scopeText}`);
        successCount++;

      } catch (error) {
        // If it's a unique constraint violation, skip it
        if (error.name === 'SequelizeUniqueConstraintError' || 
            error.message.includes('unique constraint') ||
            error.message.includes('duplicate key')) {
          console.log(`⏭️  Skipping ${method.code} (${method.name}) - duplicate detected`);
          skipCount++;
        } else {
          console.error(`❌ Error uploading ${method.code} (${method.name}):`, error.message);
          throw error; // Re-throw to trigger rollback
        }
      }
    }

    // Commit transaction
    await transaction.commit();

    console.log('\n' + '='.repeat(80));
    console.log('📊 Upload Summary:');
    console.log(`   ✅ Successfully uploaded: ${successCount}`);
    console.log(`   ⏭️  Skipped (already exists): ${skipCount}`);
    console.log(`   📥 Total from local: ${localCostingMethods.length}`);
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    await transaction.rollback();
    console.error('\n❌ Error uploading costing methods to Railway:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    await sequelize.close();
    await railwaySequelize.close();
  }
}

// Run the script
uploadCostingMethodsToRailway().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

