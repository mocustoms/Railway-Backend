#!/usr/bin/env node

/**
 * Comprehensive Review Script for Company ID Implementation
 * Checks all aspects of multi-tenant implementation
 */

const fs = require('fs');
const path = require('path');
const { Sequelize, QueryTypes } = require('sequelize');
const config = require('../env');

const sequelize = new Sequelize({
  database: config.DB_NAME,
  username: config.DB_USER,
  password: config.DB_PASSWORD,
  host: config.DB_HOST,
  port: config.DB_PORT,
  dialect: 'postgres',
  logging: false
});

const results = {
  database: { tablesWithCompanyId: [], tablesWithoutCompanyId: [] },
  models: { modelsWithCompanyId: [], modelsWithoutCompanyId: [] },
  routes: { routesWithFilter: [], routesWithoutFilter: [] },
  stats: { endpointsWithFilter: [], endpointsWithoutFilter: [] },
  imports: { importsWithCompanyId: [], importsWithoutCompanyId: [] },
  exports: { exportsWithFilter: [], exportsWithoutFilter: [] },
  reports: { reportsWithFilter: [], reportsWithoutFilter: [] }
};

async function checkDatabaseTables() {
  console.log('\n📊 Checking Database Tables...\n');
  
  try {
    const tables = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('SequelizeMeta', 'Company')
      ORDER BY table_name;
    `, { type: QueryTypes.SELECT });

    for (const table of tables) {
      const tableName = table.table_name;
      const hasCompanyId = await sequelize.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = '${tableName}' 
          AND column_name = 'companyId'
        );
      `, { type: QueryTypes.SELECT });

      if (hasCompanyId[0].exists) {
        results.database.tablesWithCompanyId.push(tableName);
        console.log(`  ✅ ${tableName}`);
      } else {
        results.database.tablesWithoutCompanyId.push(tableName);
        console.log(`  ❌ ${tableName}`);
      }
    }

    console.log(`\n  ✅ Tables with companyId: ${results.database.tablesWithCompanyId.length}`);
    console.log(`  ❌ Tables without companyId: ${results.database.tablesWithoutCompanyId.length}`);
  } catch (error) {
    console.error('Error checking database tables:', error.message);
  }
}

async function checkModels() {
  console.log('\n📦 Checking Models...\n');
  
  const modelsDir = path.join(__dirname, '../server/models');
  const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'associations.js');

  for (const file of modelFiles) {
    const filePath = path.join(modelsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for companyId field definition
    const hasCompanyId = /companyId\s*:\s*\{/i.test(content) || 
                         /companyId\s*:\s*DataTypes/i.test(content) ||
                         /field:\s*['"]companyId['"]/i.test(content);

    if (hasCompanyId) {
      results.models.modelsWithCompanyId.push(file);
      console.log(`  ✅ ${file}`);
    } else {
      // Skip Company model itself
      if (!file.includes('company.js')) {
        results.models.modelsWithoutCompanyId.push(file);
        console.log(`  ❌ ${file}`);
      }
    }
  }

  console.log(`\n  ✅ Models with companyId: ${results.models.modelsWithCompanyId.length}`);
  console.log(`  ❌ Models without companyId: ${results.models.modelsWithoutCompanyId.length}`);
}

async function checkRoutes() {
  console.log('\n🛣️  Checking Routes...\n');
  
  const routesDir = path.join(__dirname, '../server/routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for companyFilter middleware or buildCompanyWhere usage
    const hasCompanyFilter = /companyFilter/i.test(content) || 
                             /buildCompanyWhere/i.test(content) ||
                             /req\.user\.companyId/i.test(content);

    // Check if route has any endpoints
    const hasRoutes = /router\.(get|post|put|patch|delete)/i.test(content);

    if (hasRoutes) {
      if (hasCompanyFilter) {
        results.routes.routesWithFilter.push(file);
        console.log(`  ✅ ${file}`);
      } else {
        // Skip auth.js as it handles registration/login
        if (!file.includes('auth.js')) {
          results.routes.routesWithoutFilter.push(file);
          console.log(`  ❌ ${file}`);
        }
      }
    }
  }

  console.log(`\n  ✅ Routes with company filter: ${results.routes.routesWithFilter.length}`);
  console.log(`  ❌ Routes without company filter: ${results.routes.routesWithoutFilter.length}`);
}

async function checkStatsEndpoints() {
  console.log('\n📈 Checking Stats Endpoints...\n');
  
  const routesDir = path.join(__dirname, '../server/routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for stats endpoints
    const statsMatches = content.match(/router\.(get|post)\s*\(['"]\/stats[^'"]*['"]/gi);
    
    if (statsMatches) {
      // Check if stats endpoint uses company filtering
      const hasCompanyFilter = /buildCompanyWhere/i.test(content) || 
                              /req\.user\.companyId/i.test(content);
      
      if (hasCompanyFilter) {
        results.stats.endpointsWithFilter.push(file);
        console.log(`  ✅ ${file} - Stats endpoints filtered`);
      } else {
        results.stats.endpointsWithoutFilter.push(file);
        console.log(`  ❌ ${file} - Stats endpoints NOT filtered`);
      }
    }
  }

  console.log(`\n  ✅ Stats endpoints with filter: ${results.stats.endpointsWithFilter.length}`);
  console.log(`  ❌ Stats endpoints without filter: ${results.stats.endpointsWithoutFilter.length}`);
}

async function checkImportExport() {
  console.log('\n📥 Checking Import/Export Features...\n');
  
  const routesDir = path.join(__dirname, '../server/routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for import/export endpoints
    const hasImport = /\/import/i.test(content) || /import.*excel/i.test(content) || /import.*csv/i.test(content);
    const hasExport = /\/export/i.test(content) || /export.*excel/i.test(content) || /export.*pdf/i.test(content);
    
    if (hasImport) {
      // Check if import sets companyId
      const setsCompanyId = /companyId:\s*req\.user\.companyId/i.test(content);
      
      if (setsCompanyId) {
        results.imports.importsWithCompanyId.push(file);
        console.log(`  ✅ ${file} - Import sets companyId`);
      } else {
        results.imports.importsWithoutCompanyId.push(file);
        console.log(`  ❌ ${file} - Import does NOT set companyId`);
      }
    }
    
    if (hasExport) {
      // Check if export filters by companyId
      const filtersByCompany = /buildCompanyWhere/i.test(content) || 
                               /req\.user\.companyId/i.test(content);
      
      if (filtersByCompany) {
        results.exports.exportsWithFilter.push(file);
        console.log(`  ✅ ${file} - Export filters by companyId`);
      } else {
        results.exports.exportsWithoutFilter.push(file);
        console.log(`  ❌ ${file} - Export does NOT filter by companyId`);
      }
    }
  }

  console.log(`\n  ✅ Imports with companyId: ${results.imports.importsWithCompanyId.length}`);
  console.log(`  ❌ Imports without companyId: ${results.imports.importsWithoutCompanyId.length}`);
  console.log(`\n  ✅ Exports with filter: ${results.exports.exportsWithFilter.length}`);
  console.log(`  ❌ Exports without filter: ${results.exports.exportsWithoutFilter.length}`);
}

async function checkReports() {
  console.log('\n📄 Checking Reports...\n');
  
  const routesDir = path.join(__dirname, '../server/routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for report endpoints
    const hasReport = /\/report/i.test(content) || file.includes('Report') || file.includes('report');
    
    if (hasReport) {
      // Check if report filters by companyId
      const filtersByCompany = /buildCompanyWhere/i.test(content) || 
                               /req\.user\.companyId/i.test(content);
      
      if (filtersByCompany) {
        results.reports.reportsWithFilter.push(file);
        console.log(`  ✅ ${file} - Report filters by companyId`);
      } else {
        results.reports.reportsWithoutFilter.push(file);
        console.log(`  ❌ ${file} - Report does NOT filter by companyId`);
      }
    }
  }

  console.log(`\n  ✅ Reports with filter: ${results.reports.reportsWithFilter.length}`);
  console.log(`  ❌ Reports without filter: ${results.reports.reportsWithoutFilter.length}`);
}

async function generateReport() {
  console.log('\n\n' + '='.repeat(80));
  console.log('📋 COMPANY ID IMPLEMENTATION REVIEW REPORT');
  console.log('='.repeat(80));

  console.log('\n📊 DATABASE TABLES:');
  console.log(`  ✅ Tables with companyId: ${results.database.tablesWithCompanyId.length}`);
  console.log(`  ❌ Tables without companyId: ${results.database.tablesWithoutCompanyId.length}`);
  if (results.database.tablesWithoutCompanyId.length > 0) {
    console.log(`\n  Missing companyId in:`);
    results.database.tablesWithoutCompanyId.forEach(t => console.log(`    - ${t}`));
  }

  console.log('\n📦 MODELS:');
  console.log(`  ✅ Models with companyId: ${results.models.modelsWithCompanyId.length}`);
  console.log(`  ❌ Models without companyId: ${results.models.modelsWithoutCompanyId.length}`);
  if (results.models.modelsWithoutCompanyId.length > 0) {
    console.log(`\n  Missing companyId in:`);
    results.models.modelsWithoutCompanyId.forEach(m => console.log(`    - ${m}`));
  }

  console.log('\n🛣️  ROUTES:');
  console.log(`  ✅ Routes with company filter: ${results.routes.routesWithFilter.length}`);
  console.log(`  ❌ Routes without company filter: ${results.routes.routesWithoutFilter.length}`);
  if (results.routes.routesWithoutFilter.length > 0) {
    console.log(`\n  Missing company filter in:`);
    results.routes.routesWithoutFilter.forEach(r => console.log(`    - ${r}`));
  }

  console.log('\n📈 STATS ENDPOINTS:');
  console.log(`  ✅ Stats endpoints with filter: ${results.stats.endpointsWithFilter.length}`);
  console.log(`  ❌ Stats endpoints without filter: ${results.stats.endpointsWithoutFilter.length}`);
  if (results.stats.endpointsWithoutFilter.length > 0) {
    console.log(`\n  Missing company filter in:`);
    results.stats.endpointsWithoutFilter.forEach(s => console.log(`    - ${s}`));
  }

  console.log('\n📥 IMPORTS:');
  console.log(`  ✅ Imports with companyId: ${results.imports.importsWithCompanyId.length}`);
  console.log(`  ❌ Imports without companyId: ${results.imports.importsWithoutCompanyId.length}`);
  if (results.imports.importsWithoutCompanyId.length > 0) {
    console.log(`\n  Missing companyId in:`);
    results.imports.importsWithoutCompanyId.forEach(i => console.log(`    - ${i}`));
  }

  console.log('\n📤 EXPORTS:');
  console.log(`  ✅ Exports with filter: ${results.exports.exportsWithFilter.length}`);
  console.log(`  ❌ Exports without filter: ${results.exports.exportsWithoutFilter.length}`);
  if (results.exports.exportsWithoutFilter.length > 0) {
    console.log(`\n  Missing company filter in:`);
    results.exports.exportsWithoutFilter.forEach(e => console.log(`    - ${e}`));
  }

  console.log('\n📄 REPORTS:');
  console.log(`  ✅ Reports with filter: ${results.reports.reportsWithFilter.length}`);
  console.log(`  ❌ Reports without filter: ${results.reports.reportsWithoutFilter.length}`);
  if (results.reports.reportsWithoutFilter.length > 0) {
    console.log(`\n  Missing company filter in:`);
    results.reports.reportsWithoutFilter.forEach(r => console.log(`    - ${r}`));
  }

  // Calculate completion percentage
  const totalChecks = 
    results.database.tablesWithCompanyId.length + results.database.tablesWithoutCompanyId.length +
    results.models.modelsWithCompanyId.length + results.models.modelsWithoutCompanyId.length +
    results.routes.routesWithFilter.length + results.routes.routesWithoutFilter.length +
    results.stats.endpointsWithFilter.length + results.stats.endpointsWithoutFilter.length +
    results.imports.importsWithCompanyId.length + results.imports.importsWithoutCompanyId.length +
    results.exports.exportsWithFilter.length + results.exports.exportsWithoutFilter.length +
    results.reports.reportsWithFilter.length + results.reports.reportsWithoutFilter.length;

  const completedChecks = 
    results.database.tablesWithCompanyId.length +
    results.models.modelsWithCompanyId.length +
    results.routes.routesWithFilter.length +
    results.stats.endpointsWithFilter.length +
    results.imports.importsWithCompanyId.length +
    results.exports.exportsWithFilter.length +
    results.reports.reportsWithFilter.length;

  const completionPercentage = totalChecks > 0 ? ((completedChecks / totalChecks) * 100).toFixed(2) : 0;

  console.log('\n' + '='.repeat(80));
  console.log(`📊 OVERALL COMPLETION: ${completionPercentage}%`);
  console.log('='.repeat(80));

  // Save results to JSON file
  const reportPath = path.join(__dirname, '../company-id-implementation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Detailed report saved to: ${reportPath}`);
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    await checkDatabaseTables();
    await checkModels();
    await checkRoutes();
    await checkStatsEndpoints();
    await checkImportExport();
    await checkReports();
    await generateReport();
    
    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

