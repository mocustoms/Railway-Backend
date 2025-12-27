/**
 * CompanyId Security Audit Script
 * 
 * Scans all route files to identify potential multi-tenant security vulnerabilities:
 * 1. Routes that might accept companyId from req.body
 * 2. Routes that don't use req.user.companyId
 * 3. Service functions that might accept companyId from data parameter
 * 4. Missing stripCompanyId middleware
 * 
 * Usage: node scripts/audit-companyid-security.js
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../server/routes');
const SERVICES_DIR = path.join(__dirname, '../server/services');

const issues = {
    routes: [],
    services: [],
    missingMiddleware: []
};

// Patterns to search for
const VULNERABLE_PATTERNS = [
    /req\.body\.companyId/gi,
    /req\.query\.companyId/gi,
    /companyId\s*=\s*req\.body/gi,
    /companyId\s*=\s*req\.query/gi,
    /const\s+\{\s*.*companyId/gi,
    /\.create\(.*req\.body/gi,
    /\.update\(.*req\.body/gi,
    /\.bulkCreate\(.*req\.body/gi
];

const SAFE_PATTERNS = [
    /req\.user\.companyId/gi,
    /stripCompanyId/gi,
    /validateServiceCompanyId/gi,
    /removeCompanyIdFromData/gi
];

function scanFile(filePath, type) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const fileName = path.basename(filePath);
    
    let hasVulnerablePattern = false;
    let hasSafePattern = false;
    let vulnerableLines = [];
    let safeLines = [];
    
    // Check for vulnerable patterns
    VULNERABLE_PATTERNS.forEach((pattern, index) => {
        const matches = content.match(pattern);
        if (matches) {
            hasVulnerablePattern = true;
            lines.forEach((line, lineNum) => {
                if (pattern.test(line)) {
                    vulnerableLines.push({
                        line: lineNum + 1,
                        content: line.trim(),
                        pattern: pattern.toString()
                    });
                }
            });
        }
    });
    
    // Check for safe patterns
    SAFE_PATTERNS.forEach((pattern) => {
        if (pattern.test(content)) {
            hasSafePattern = true;
            lines.forEach((line, lineNum) => {
                if (pattern.test(line)) {
                    safeLines.push({
                        line: lineNum + 1,
                        content: line.trim()
                    });
                }
            });
        }
    });
    
    // Check for stripCompanyId middleware
    const hasStripMiddleware = /stripCompanyId|require\(['"]\.\.\/middleware\/stripCompanyId['"]\)/gi.test(content);
    
    if (type === 'route') {
        // Check if route uses auth middleware
        const hasAuth = /router\.use\(auth\)|require\(['"]\.\.\/middleware\/auth['"]\)/gi.test(content);
        
        if (hasVulnerablePattern) {
            issues.routes.push({
                file: fileName,
                path: filePath,
                severity: 'HIGH',
                issue: 'Potential companyId override vulnerability',
                vulnerableLines,
                hasSafePattern,
                hasAuth,
                hasStripMiddleware,
                recommendation: hasStripMiddleware 
                    ? 'Add stripCompanyId middleware if not already applied'
                    : 'Add stripCompanyId middleware and ensure companyId comes from req.user.companyId only'
            });
        } else if (hasAuth && !hasStripMiddleware) {
            issues.missingMiddleware.push({
                file: fileName,
                path: filePath,
                severity: 'MEDIUM',
                issue: 'Missing stripCompanyId middleware',
                recommendation: 'Add router.use(stripCompanyId) after auth middleware'
            });
        }
    } else if (type === 'service') {
        if (hasVulnerablePattern && !hasSafePattern) {
            issues.services.push({
                file: fileName,
                path: filePath,
                severity: 'HIGH',
                issue: 'Service function might accept companyId from data parameter',
                vulnerableLines,
                recommendation: 'Add validateServiceCompanyId and removeCompanyIdFromData validation'
            });
        }
    }
}

function scanDirectory(dir, type) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            scanDirectory(filePath, type);
        } else if (file.endsWith('.js')) {
            scanFile(filePath, type);
        }
    });
}

// Scan routes
console.log('🔍 Scanning route files...');
scanDirectory(ROUTES_DIR, 'route');

// Scan services
console.log('🔍 Scanning service files...');
scanDirectory(SERVICES_DIR, 'service');

// Generate report
console.log('\n' + '='.repeat(80));
console.log('COMPANYID SECURITY AUDIT REPORT');
console.log('='.repeat(80));

if (issues.routes.length === 0 && issues.services.length === 0 && issues.missingMiddleware.length === 0) {
    console.log('\n✅ No security issues found! All routes and services appear secure.');
} else {
    if (issues.routes.length > 0) {
        console.log(`\n⚠️  HIGH SEVERITY: ${issues.routes.length} route(s) with potential vulnerabilities:`);
        issues.routes.forEach((issue, index) => {
            console.log(`\n${index + 1}. ${issue.file}`);
            console.log(`   Path: ${issue.path}`);
            console.log(`   Issue: ${issue.issue}`);
            console.log(`   Has Auth: ${issue.hasAuth ? '✅' : '❌'}`);
            console.log(`   Has stripCompanyId: ${issue.hasStripMiddleware ? '✅' : '❌'}`);
            if (issue.vulnerableLines.length > 0) {
                console.log(`   Vulnerable lines:`);
                issue.vulnerableLines.slice(0, 3).forEach(vl => {
                    console.log(`     Line ${vl.line}: ${vl.content.substring(0, 80)}...`);
                });
            }
            console.log(`   Recommendation: ${issue.recommendation}`);
        });
    }
    
    if (issues.services.length > 0) {
        console.log(`\n⚠️  HIGH SEVERITY: ${issues.services.length} service(s) with potential vulnerabilities:`);
        issues.services.forEach((issue, index) => {
            console.log(`\n${index + 1}. ${issue.file}`);
            console.log(`   Path: ${issue.path}`);
            console.log(`   Issue: ${issue.issue}`);
            if (issue.vulnerableLines.length > 0) {
                console.log(`   Vulnerable lines:`);
                issue.vulnerableLines.slice(0, 3).forEach(vl => {
                    console.log(`     Line ${vl.line}: ${vl.content.substring(0, 80)}...`);
                });
            }
            console.log(`   Recommendation: ${issue.recommendation}`);
        });
    }
    
    if (issues.missingMiddleware.length > 0) {
        console.log(`\n⚠️  MEDIUM SEVERITY: ${issues.missingMiddleware.length} route(s) missing stripCompanyId middleware:`);
        issues.missingMiddleware.forEach((issue, index) => {
            console.log(`\n${index + 1}. ${issue.file}`);
            console.log(`   Path: ${issue.path}`);
            console.log(`   Recommendation: ${issue.recommendation}`);
        });
    }
}

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Total routes scanned: ${fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js')).length}`);
console.log(`Total services scanned: ${fs.readdirSync(SERVICES_DIR).filter(f => f.endsWith('.js')).length}`);
console.log(`High severity issues: ${issues.routes.length + issues.services.length}`);
console.log(`Medium severity issues: ${issues.missingMiddleware.length}`);
console.log('\n');

// Exit with error code if issues found
if (issues.routes.length > 0 || issues.services.length > 0) {
    process.exit(1);
}

