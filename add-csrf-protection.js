const fs = require('fs');
const path = require('path');

// List of modules that already have CSRF protection
const modulesWithCSRF = [
  'currency.js',
  'customerImport.js', 
  'productImport.js',
  'auth.js'
];

// List of all route files
const routeFiles = [
  'customer.js',
  'customerGroup.js',
  'loyaltyCardConfig.js',
  'loyaltyConfig.js',
  'loyaltyCard.js',
  'productStoreLocation.js',
  'productCategory.js',
  'pharmaceutical.js',
  'stockAdjustment.js',
  'administration.js',
  'manufacturing.js',
  'autoCode.js',
  'physicalInventoryNew.js',
  'serialBatchSearch.js',
  'stockBalance.js',
  'trialBalance.js',
  'priceHistory.js',
  'productTransaction.js',
  'productStore.js',
  'physicalInventory.js',
  'priceCategory.js',
  'openingBalance.js',
  'storeRequest.js',
  'adjustmentReason.js',
  'taxCode.js',
  'packaging.js',
  'productColor.js',
  'productModel.js',
  'productManufacturer.js',
  'productBrandName.js',
  'account.js',
  'financialYear.js',
  'company.js',
  'product.js',
  'store.js',
  'user.js',
  'salesAgent.js',
  'paymentType.js',
  'paymentMethod.js',
  'exchangeRate.js',
  'adjustmentReasonStats.js'
];

const routesDir = path.join(__dirname, 'server', 'routes');

function addCSRFProtection(fileName) {
  const filePath = path.join(routesDir, fileName);
  
  if (!fs.existsSync(filePath)) {
    console.log(`❌ File not found: ${fileName}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  
  // Check if CSRF protection is already imported
  if (content.includes('csrfProtection')) {
    console.log(`✅ ${fileName} already has CSRF protection`);
    return;
  }

  // Add CSRF protection import
  const csrfImport = "const { csrfProtection } = require('../middleware/csrfProtection');";
  
  // Find the auth import line and add CSRF import after it
  const authImportRegex = /const auth = require\('\.\.\/middleware\/auth'\);/;
  if (authImportRegex.test(content)) {
    content = content.replace(authImportRegex, `const auth = require('../middleware/auth');\n${csrfImport}`);
  } else {
    // If no auth import found, add it at the top after other requires
    const requireRegex = /(const.*require\([^)]+\);)/;
    const match = content.match(requireRegex);
    if (match) {
      content = content.replace(match[0], `${match[0]}\n${csrfImport}`);
    }
  }

  // Add CSRF protection to all POST, PUT, DELETE routes
  content = content.replace(
    /router\.(post|put|delete)\(([^,]+),\s*auth,\s*async/g,
    'router.$1($2, auth, csrfProtection, async'
  );

  // Handle routes that don't have auth middleware
  content = content.replace(
    /router\.(post|put|delete)\(([^,]+),\s*async/g,
    'router.$1($2, csrfProtection, async'
  );

  fs.writeFileSync(filePath, content);
  console.log(`✅ Added CSRF protection to ${fileName}`);
}

console.log('🔒 Adding CSRF protection to all route modules...\n');

routeFiles.forEach(fileName => {
  if (!modulesWithCSRF.includes(fileName)) {
    addCSRFProtection(fileName);
  }
});

console.log('\n🎉 CSRF protection implementation complete!');
