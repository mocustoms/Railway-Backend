/**
 * Script to add stripCompanyId middleware to all route files
 * 
 * This script automatically adds the stripCompanyId middleware import and usage
 * to all route files that use auth middleware but don't already have stripCompanyId.
 * 
 * Usage: node scripts/add-strip-companyid-middleware.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../server/routes');
const DRY_RUN = process.argv.includes('--dry-run');

const updatedFiles = [];
const skippedFiles = [];
const errorFiles = [];

function updateRouteFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        const fileName = path.basename(filePath);
        
        // Skip if already has stripCompanyId
        if (content.includes('stripCompanyId')) {
            skippedFiles.push(fileName);
            return;
        }
        
        // Skip if doesn't use auth middleware
        if (!content.includes('router.use(auth)') && !content.includes('require(\'../middleware/auth\')')) {
            skippedFiles.push(fileName);
            return;
        }
        
        let modified = false;
        
        // Add import if not present
        if (!content.includes('require(\'../middleware/stripCompanyId\')') && 
            !content.includes('require("../middleware/stripCompanyId")')) {
            // Find the auth import line
            const authImportRegex = /const\s+auth\s*=\s*require\(['"]\.\.\/middleware\/auth['"]\);/;
            const authImportMatch = content.match(authImportRegex);
            
            if (authImportMatch) {
                // Add stripCompanyId import after auth import
                const insertPoint = authImportMatch.index + authImportMatch[0].length;
                const newImport = '\nconst stripCompanyId = require(\'../middleware/stripCompanyId\');';
                content = content.slice(0, insertPoint) + newImport + content.slice(insertPoint);
                modified = true;
            } else {
                // Try to find where middleware imports are
                const middlewareImports = content.match(/const\s+\w+\s*=\s*require\(['"]\.\.\/middleware\/\w+['"]\);/g);
                if (middlewareImports && middlewareImports.length > 0) {
                    const lastImport = middlewareImports[middlewareImports.length - 1];
                    const lastImportIndex = content.lastIndexOf(lastImport);
                    const insertPoint = lastImportIndex + lastImport.length;
                    const newImport = '\nconst stripCompanyId = require(\'../middleware/stripCompanyId\');';
                    content = content.slice(0, insertPoint) + newImport + content.slice(insertPoint);
                    modified = true;
                }
            }
        }
        
        // Add middleware usage if not present
        if (!content.includes('router.use(stripCompanyId)')) {
            // Find router.use(auth) or router.use(companyFilter)
            const routerUseRegex = /router\.use\((auth|companyFilter)\);/g;
            let lastMatch = null;
            let match;
            
            while ((match = routerUseRegex.exec(content)) !== null) {
                lastMatch = match;
            }
            
            if (lastMatch) {
                // Add stripCompanyId after the last middleware
                const insertPoint = lastMatch.index + lastMatch[0].length;
                const newMiddleware = '\nrouter.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks';
                content = content.slice(0, insertPoint) + newMiddleware + content.slice(insertPoint);
                modified = true;
            }
        }
        
        if (modified) {
            if (!DRY_RUN) {
                fs.writeFileSync(filePath, content, 'utf8');
            }
            updatedFiles.push(fileName);
            console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}✅ Updated: ${fileName}`);
        } else {
            skippedFiles.push(fileName);
        }
    } catch (error) {
        errorFiles.push({ file: path.basename(filePath), error: error.message });
        console.error(`❌ Error updating ${path.basename(filePath)}: ${error.message}`);
    }
}

function scanDirectory(dir) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            scanDirectory(filePath);
        } else if (file.endsWith('.js')) {
            updateRouteFile(filePath);
        }
    });
}

console.log(`${DRY_RUN ? '🔍 DRY RUN MODE - No files will be modified\n' : '🚀 Updating route files...\n'}`);
scanDirectory(ROUTES_DIR);

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`✅ Updated: ${updatedFiles.length} file(s)`);
console.log(`⏭️  Skipped: ${skippedFiles.length} file(s)`);
console.log(`❌ Errors: ${errorFiles.length} file(s)`);

if (updatedFiles.length > 0) {
    console.log('\nUpdated files:');
    updatedFiles.forEach(file => console.log(`  - ${file}`));
}

if (errorFiles.length > 0) {
    console.log('\nFiles with errors:');
    errorFiles.forEach(({ file, error }) => console.log(`  - ${file}: ${error}`));
}

if (DRY_RUN && updatedFiles.length > 0) {
    console.log('\n💡 Run without --dry-run to apply changes');
}

console.log('');

