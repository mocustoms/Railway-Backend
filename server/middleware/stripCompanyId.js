/**
 * Strip CompanyId Middleware
 * 
 * Security middleware to prevent companyId from being overridden via request body or query parameters.
 * This ensures that companyId can ONLY come from the authenticated user's JWT token (req.user.companyId).
 * 
 * CRITICAL: This prevents multi-tenant data isolation bypass attacks.
 * 
 * Usage:
 *   - Apply after auth middleware but before route handlers
 *   - Automatically removes companyId from req.body and req.query
 *   - Logs warnings if companyId is detected in user input (potential attack)
 */

const stripCompanyId = (req, res, next) => {
    let stripped = false;
    let source = null;
    
    // Remove companyId from request body
    if (req.body && req.body.companyId !== undefined) {
        const attemptedCompanyId = req.body.companyId;
        delete req.body.companyId;
        stripped = true;
        source = 'body';
        
        // Log warning - this could be an attack attempt
        console.warn(`⚠️  SECURITY: companyId stripped from req.body`, {
            path: req.path,
            method: req.method,
            userId: req.user?.id,
            userCompanyId: req.user?.companyId,
            attemptedCompanyId: attemptedCompanyId,
            ip: req.ip || req.connection?.remoteAddress
        });
    }
    
    // Remove companyId from query parameters
    if (req.query && req.query.companyId !== undefined) {
        const attemptedCompanyId = req.query.companyId;
        delete req.query.companyId;
        stripped = true;
        source = source ? `${source}, query` : 'query';
        
        // Log warning - this could be an attack attempt
        console.warn(`⚠️  SECURITY: companyId stripped from req.query`, {
            path: req.path,
            method: req.method,
            userId: req.user?.id,
            userCompanyId: req.user?.companyId,
            attemptedCompanyId: attemptedCompanyId,
            ip: req.ip || req.connection?.remoteAddress
        });
    }
    
    // Remove companyId from params (shouldn't happen, but be safe)
    if (req.params && req.params.companyId !== undefined && req.path !== '/api/company/:companyId') {
        // Only strip if it's not a legitimate companyId parameter in the route
        const attemptedCompanyId = req.params.companyId;
        delete req.params.companyId;
        stripped = true;
        source = source ? `${source}, params` : 'params';
        
        console.warn(`⚠️  SECURITY: companyId stripped from req.params`, {
            path: req.path,
            method: req.method,
            userId: req.user?.id,
            userCompanyId: req.user?.companyId,
            attemptedCompanyId: attemptedCompanyId,
            ip: req.ip || req.connection?.remoteAddress
        });
    }
    
    next();
};

module.exports = stripCompanyId;

