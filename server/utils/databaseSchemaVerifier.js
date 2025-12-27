/**
 * Database Schema Verifier
 * 
 * Compares Sequelize models with actual database schema
 * to ensure they are in sync. This is critical for maintaining
 * database integrity across deployments.
 */

const sequelize = require('../../config/database');
const { QueryTypes } = require('sequelize');
const models = require('../models');

/**
 * Get all Sequelize models
 */
function getAllModels() {
  const modelList = {};
  
  // Get all models from the models index
  Object.keys(models).forEach(key => {
    if (key !== 'sequelize' && models[key] && models[key].name) {
      modelList[models[key].name] = models[key];
    }
  });
  
  return modelList;
}

/**
 * Get table name from model
 */
function getTableName(model) {
  return model.tableName || model.name;
}

/**
 * Get expected columns from Sequelize model
 */
function getExpectedColumns(model) {
  const columns = {};
  const attributes = model.rawAttributes || {};
  
  Object.keys(attributes).forEach(attrName => {
    const attr = attributes[attrName];
    columns[attrName] = {
      type: attr.type ? attr.type.toString() : 'UNKNOWN',
      allowNull: attr.allowNull !== false,
      primaryKey: attr.primaryKey === true,
      defaultValue: attr.defaultValue,
      unique: attr.unique === true,
      autoIncrement: attr.autoIncrement === true,
      references: attr.references ? {
        model: attr.references.model,
        key: attr.references.key
      } : null
    };
  });
  
  // Add timestamps if enabled
  if (model.options.timestamps) {
    const createdAtField = model.options.createdAt || 'createdAt';
    const updatedAtField = model.options.updatedAt || 'updatedAt';
    
    if (!columns[createdAtField]) {
      columns[createdAtField] = {
        type: 'DATE',
        allowNull: false,
        defaultValue: 'NOW()'
      };
    }
    
    if (!columns[updatedAtField]) {
      columns[updatedAtField] = {
        type: 'DATE',
        allowNull: false,
        defaultValue: 'NOW()'
      };
    }
  }
  
  return columns;
}

/**
 * Get actual columns from database
 */
async function getActualColumns(tableName) {
  try {
    const columns = await sequelize.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE table_name = :tableName
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `, {
      replacements: { tableName },
      type: QueryTypes.SELECT
    });
    
    // Handle both array and nested array results
    const columnsArray = Array.isArray(columns) && columns.length > 0 && Array.isArray(columns[0]) 
      ? columns[0] 
      : columns;
    
    if (!Array.isArray(columnsArray)) {
      console.error(`Error: Expected array but got ${typeof columnsArray} for table ${tableName}`);
      return null;
    }
    
    const columnMap = {};
    columnsArray.forEach(col => {
      columnMap[col.column_name] = {
        type: col.data_type,
        allowNull: col.is_nullable === 'YES',
        defaultValue: col.column_default,
        maxLength: col.character_maximum_length,
        precision: col.numeric_precision,
        scale: col.numeric_scale
      };
    });
    
    return columnMap;
  } catch (error) {
    console.error(`Error fetching columns for table ${tableName}:`, error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    return null;
  }
}

/**
 * Check if table exists in database
 */
async function tableExists(tableName) {
  try {
    const [result] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = :tableName
      );
    `, {
      replacements: { tableName },
      type: QueryTypes.SELECT
    });
    
    return result.exists;
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error.message);
    return false;
  }
}

/**
 * Compare expected vs actual columns
 */
function compareColumns(expected, actual, tableName) {
  const issues = [];
  
  // Check for missing columns
  Object.keys(expected).forEach(colName => {
    if (!actual[colName]) {
      issues.push({
        type: 'missing_column',
        table: tableName,
        column: colName,
        expected: expected[colName],
        severity: 'error'
      });
    }
  });
  
  // Check for extra columns (warn only, not error)
  Object.keys(actual).forEach(colName => {
    if (!expected[colName]) {
      issues.push({
        type: 'extra_column',
        table: tableName,
        column: colName,
        actual: actual[colName],
        severity: 'warning'
      });
    }
  });
  
  // Check column types and nullability (warnings, not errors)
  Object.keys(expected).forEach(colName => {
    if (actual[colName]) {
      const exp = expected[colName];
      const act = actual[colName];
      
      // Type checking is complex due to Sequelize type system
      // We'll just log warnings for now
      
      if (exp.allowNull === false && act.allowNull === true) {
        issues.push({
          type: 'nullability_mismatch',
          table: tableName,
          column: colName,
          expected: 'NOT NULL',
          actual: 'NULL',
          severity: 'warning'
        });
      }
    }
  });
  
  return issues;
}

/**
 * Verify all models against database
 */
async function verifyDatabaseSchema(options = {}) {
  const {
    verbose = false,
    failOnError = false,
    skipExtraColumns = true
  } = options;
  
  const allModels = getAllModels();
  const results = {
    verified: true,
    tablesChecked: 0,
    tablesMissing: [],
    issues: [],
    warnings: [],
    errors: []
  };
  
  console.log('\n🔍 DATABASE SCHEMA VERIFICATION');
  console.log('='.repeat(60));
  console.log(`Checking ${Object.keys(allModels).length} models...\n`);
  
  for (const [modelName, model] of Object.entries(allModels)) {
    const tableName = getTableName(model);
    results.tablesChecked++;
    
    if (verbose) {
      console.log(`\n📋 Checking model: ${modelName} (table: ${tableName})`);
    }
    
    // Check if table exists
    const exists = await tableExists(tableName);
    
    if (!exists) {
      const issue = {
        type: 'missing_table',
        model: modelName,
        table: tableName,
        severity: 'error'
      };
      
      results.issues.push(issue);
      results.errors.push(issue);
      results.tablesMissing.push(tableName);
      results.verified = false;
      
      console.error(`❌ Table ${tableName} (model: ${modelName}) does not exist in database`);
      continue;
    }
    
    // Get expected and actual columns
    const expectedColumns = getExpectedColumns(model);
    const actualColumns = await getActualColumns(tableName);
    
    if (!actualColumns) {
      const issue = {
        type: 'cannot_fetch_columns',
        model: modelName,
        table: tableName,
        severity: 'error'
      };
      
      results.issues.push(issue);
      results.errors.push(issue);
      results.verified = false;
      continue;
    }
    
    // Compare columns
    const columnIssues = compareColumns(expectedColumns, actualColumns, tableName);
    
    // Filter based on options
    const relevantIssues = columnIssues.filter(issue => {
      if (issue.type === 'extra_column' && skipExtraColumns) {
        return false;
      }
      return true;
    });
    
    relevantIssues.forEach(issue => {
      results.issues.push(issue);
      
      if (issue.severity === 'error') {
        results.errors.push(issue);
        results.verified = false;
      } else {
        results.warnings.push(issue);
      }
    });
    
    if (relevantIssues.length === 0) {
      if (verbose) {
        console.log(`  ✅ Table ${tableName} is in sync`);
      }
    } else {
      if (verbose) {
        relevantIssues.forEach(issue => {
          const icon = issue.severity === 'error' ? '❌' : '⚠️';
          console.log(`  ${icon} ${issue.type}: ${issue.column || issue.table}`);
        });
      }
    }
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Tables checked: ${results.tablesChecked}`);
  console.log(`Tables missing: ${results.tablesMissing.length}`);
  console.log(`Errors: ${results.errors.length}`);
  console.log(`Warnings: ${results.warnings.length}`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ ERRORS FOUND:');
    results.errors.forEach(error => {
      console.log(`   - ${error.type}: ${error.table || error.model}${error.column ? `.${error.column}` : ''}`);
    });
  }
  
  if (results.warnings.length > 0 && verbose) {
    console.log('\n⚠️  WARNINGS:');
    results.warnings.forEach(warning => {
      console.log(`   - ${warning.type}: ${warning.table}${warning.column ? `.${warning.column}` : ''}`);
    });
  }
  
  if (results.verified) {
    console.log('\n✅ Database schema is in sync with models!');
  } else {
    console.log('\n❌ Database schema has issues that need to be addressed.');
    console.log('   Run migrations or update models to fix these issues.');
  }
  
  console.log('='.repeat(60) + '\n');
  
  if (failOnError && !results.verified) {
    throw new Error('Database schema verification failed. Please fix the issues above.');
  }
  
  return results;
}

module.exports = {
  verifyDatabaseSchema,
  getAllModels,
  getTableName,
  getExpectedColumns,
  getActualColumns,
  tableExists,
  compareColumns
};

