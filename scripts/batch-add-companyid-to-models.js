#!/usr/bin/env node

/**
 * Batch script to add companyId to all models
 * This script reads model files and adds companyId field definition
 */

const fs = require('fs');
const path = require('path');

const modelsDir = path.join(__dirname, '../server/models');
const modelsToSkip = [
  'index.js',
  'associations.js',
  'company.js',
  'user.js',
  'Customer.js',
  'generalLedger.js',
  'physicalInventory.js',
  'physicalInventoryItem.js',
  'product.js',
  'store.js',
  'currency.js',
  'taxCode.js',
  'productCategory.js',
  'CustomerDeposit.js',
  'customerGroup.js',
  'account.js',
  'accountType.js',
  'accountTypeAudit.js'
];

const companyIdField = `    companyId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'companyId', // Explicitly set field name
        references: {
           model: 'company',
            key: 'id'
        },
        comment: 'Foreign key to Company for multi-tenant isolation'
    }`;

const companyIdFieldForModule = `    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'companyId', // Explicitly set field name
      references: {
       model: 'company',
        key: 'id'
      },
      comment: 'Foreign key to Company for multi-tenant isolation'
    }`;

function addCompanyIdToModel(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Skip if already has companyId
  if (/companyId\s*:\s*\{/i.test(content)) {
    return false;
  }
  
  // Find the last field before the closing brace
  // Look for patterns like: }, { or }, { sequelize
  const lines = content.split('\n');
  let lastFieldIndex = -1;
  let optionsStartIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().match(/^\},\s*\{/) || lines[i].trim().match(/^\}\)\s*=>\s*\{/)) {
      optionsStartIndex = i;
      break;
    }
  }
  
  if (optionsStartIndex === -1) {
    console.log(`⚠️  Could not find options start in ${path.basename(filePath)}`);
    return false;
  }
  
  // Find the last field before options
  for (let i = optionsStartIndex - 1; i >= 0; i--) {
    if (lines[i].trim() && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
      lastFieldIndex = i;
      break;
    }
  }
  
  if (lastFieldIndex === -1) {
    console.log(`⚠️  Could not find last field in ${path.basename(filePath)}`);
    return false;
  }
  
  // Determine indentation
  const indent = lines[lastFieldIndex].match(/^(\s*)/)[1];
  
  // Insert companyId field
  const fieldToAdd = content.includes('module.exports = (sequelize)') 
    ? companyIdFieldForModule.split('\n').map(l => indent + l).join('\n')
    : companyIdField.split('\n').map(l => indent + l).join('\n');
  
  // Insert before the closing brace
  const newLines = [...lines];
  newLines.splice(lastFieldIndex + 1, 0, '', ...fieldToAdd.split('\n'));
  
  // Also add index if indexes array exists
  let newContent = newLines.join('\n');
  if (newContent.includes('indexes:') && !newContent.includes("fields: ['companyId']")) {
    // Find indexes array and add companyId index
    const indexesMatch = newContent.match(/(indexes:\s*\[[\s\S]*?)(\s*\]\s*)/);
    if (indexesMatch) {
      const indexToAdd = `        {\n            fields: ['companyId']\n        }`;
      newContent = newContent.replace(indexesMatch[0], indexesMatch[1] + indexToAdd + '\n' + indexesMatch[2]);
    }
  }
  
  fs.writeFileSync(filePath, newContent, 'utf8');
  return true;
}

const modelFiles = fs.readdirSync(modelsDir)
  .filter(f => f.endsWith('.js') && !modelsToSkip.includes(f));

console.log(`Found ${modelFiles.length} models to update\n`);

let updated = 0;
for (const file of modelFiles) {
  const filePath = path.join(modelsDir, file);
  if (addCompanyIdToModel(filePath)) {
    console.log(`✅ Updated ${file}`);
    updated++;
  } else {
    console.log(`⏭️  Skipped ${file} (already has companyId or error)`);
  }
}

console.log(`\n✅ Updated ${updated} models`);

