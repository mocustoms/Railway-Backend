#!/usr/bin/env node

/**
 * Railway Uploads Diagnostic Script
 * 
 * This script helps diagnose why images aren't being saved on Railway.
 * It checks:
 * 1. Current working directory
 * 2. Uploads directory path
 * 3. Directory existence and permissions
 * 4. Volume mount status
 * 
 * Run this on Railway via: Railway Dashboard → Service → Shell
 * Then run: node backend/scripts/diagnose-railway-uploads.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

console.log('\n🔍 Railway Uploads Diagnostic');
console.log('='.repeat(80));

// 1. Check current working directory
console.log('\n📂 Current Working Directory:');
console.log(`   ${process.cwd()}`);

// 2. Check __dirname (where server.js is located)
const serverDir = path.join(__dirname, '..');
console.log('\n📂 Server Directory (__dirname from server.js):');
console.log(`   ${serverDir}`);

// 3. Check expected uploads path
const expectedUploadsPath = path.join(serverDir, 'uploads');
console.log('\n📁 Expected Uploads Path (from server.js):');
console.log(`   ${expectedUploadsPath}`);

// 4. Check if uploads directory exists
console.log('\n✅ Directory Existence Check:');
const uploadsExists = fs.existsSync(expectedUploadsPath);
console.log(`   Uploads directory exists: ${uploadsExists ? '✅ YES' : '❌ NO'}`);

if (uploadsExists) {
  try {
    const stats = fs.statSync(expectedUploadsPath);
    console.log(`   Is directory: ${stats.isDirectory() ? '✅ YES' : '❌ NO'}`);
    console.log(`   Permissions: ${stats.mode.toString(8)}`);
  } catch (error) {
    console.log(`   ❌ Error reading directory: ${error.message}`);
  }
} else {
  console.log(`   ⚠️  Directory does not exist!`);
  console.log(`   Attempting to create...`);
  try {
    fs.mkdirSync(expectedUploadsPath, { recursive: true });
    console.log(`   ✅ Successfully created directory`);
  } catch (error) {
    console.log(`   ❌ Failed to create: ${error.message}`);
  }
}

// 5. Check subdirectories
console.log('\n📁 Subdirectories Check:');
const subdirs = [
  'products',
  'profile-pictures',
  'customer-deposits',
  'company-logos',
  'product-brand-name-logos',
  'product-manufacturer-logos',
  'product-model-logos',
  'sales-agent-photos',
  'temp'
];

subdirs.forEach(subdir => {
  const subdirPath = path.join(expectedUploadsPath, subdir);
  const exists = fs.existsSync(subdirPath);
  console.log(`   ${subdir}/: ${exists ? '✅' : '❌'}`);
});

// 6. Test write permissions
console.log('\n✍️  Write Permission Test:');
try {
  const testFile = path.join(expectedUploadsPath, 'test-write.txt');
  fs.writeFileSync(testFile, `Test write at ${new Date().toISOString()}\n`);
  const canRead = fs.existsSync(testFile);
  fs.unlinkSync(testFile);
  console.log(`   ✅ Can write: YES`);
  console.log(`   ✅ Can read: ${canRead ? 'YES' : 'NO'}`);
} catch (error) {
  console.log(`   ❌ Write test failed: ${error.message}`);
}

// 7. Check volume mount (if on Railway)
console.log('\n💾 Volume Mount Check:');
const possibleMountPaths = [
  '/app/backend/uploads',
  '/app/uploads',
  expectedUploadsPath
];

possibleMountPaths.forEach(mountPath => {
  const exists = fs.existsSync(mountPath);
  console.log(`   ${mountPath}: ${exists ? '✅ EXISTS' : '❌ NOT FOUND'}`);
  
  if (exists) {
    try {
      const stats = fs.statSync(mountPath);
      console.log(`      Type: ${stats.isDirectory() ? 'Directory' : 'File'}`);
      console.log(`      Mounted: ${stats.dev ? 'Possibly (has device)' : 'Unknown'}`);
    } catch (error) {
      // Ignore
    }
  }
});

// 8. Check environment
console.log('\n🌍 Environment Check:');
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`   Platform: ${os.platform()}`);
console.log(`   Architecture: ${os.arch()}`);

// 9. Recommendations
console.log('\n💡 Recommendations:');
if (!uploadsExists) {
  console.log('   ❌ Uploads directory does not exist!');
  console.log('   → Create it manually or ensure volume is mounted');
}

const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME;
if (isRailway) {
  console.log('   ✅ Running on Railway');
  console.log('   → Verify volume is mounted at: /app/backend/uploads');
  console.log('   → Check Railway Dashboard → Service → Settings → Volumes');
} else {
  console.log('   ⚠️  Not running on Railway (or Railway env vars not set)');
}

console.log('\n' + '='.repeat(80));
console.log('');

