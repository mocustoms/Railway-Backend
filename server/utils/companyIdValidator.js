/**
 * CompanyId Validator Utility
 * 
 * Provides validation functions to ensure companyId is:
 * 1. Always from req.user.companyId (never from user input)
 * 2. Properly validated before use
 * 3. Never null/undefined for non-system-admin users
 * 
 * CRITICAL: This prevents multi-tenant data isolation bypass attacks.
 */

/**
 * Validates and extracts companyId from authenticated user
 * @param {Object} req - Express request object
 * @param {boolean} allowSystemAdmin - Allow system admins without companyId (default: true)
 * @returns {string|null} - Validated companyId or null for system admins
 * @throws {Error} - If companyId is invalid or missing for regular users
 */
function validateAndExtractCompanyId(req, allowSystemAdmin = true) {
    // System admins can bypass companyId requirement
    if (allowSystemAdmin && req.user?.isSystemAdmin) {
        return null; // System admins don't need companyId
    }
    
    // Regular users must have companyId
    if (!req.user || !req.user.companyId) {
        throw new Error('Company access required. User must be assigned to a company.');
    }
    
    const companyId = req.user.companyId;
    
    // Validate companyId format (should be UUID)
    if (typeof companyId !== 'string' || companyId.trim() === '') {
        throw new Error('Invalid companyId format. CompanyId must be a non-empty string.');
    }
    
    // Basic UUID format validation (v4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(companyId)) {
        throw new Error('Invalid companyId format. CompanyId must be a valid UUID.');
    }
    
    return companyId;
}

/**
 * Validates that a companyId parameter matches the user's companyId
 * Prevents users from accessing other companies' data
 * @param {Object} req - Express request object
 * @param {string} requestedCompanyId - CompanyId from request (params, body, or query)
 * @returns {boolean} - True if companyId matches or user is system admin
 * @throws {Error} - If companyId doesn't match user's companyId
 */
function validateCompanyIdAccess(req, requestedCompanyId) {
    // System admins can access any company
    if (req.user?.isSystemAdmin) {
        return true;
    }
    
    // If no requestedCompanyId, allow (will be set from req.user.companyId)
    if (!requestedCompanyId) {
        return true;
    }
    
    // Regular users can only access their own company
    if (req.user?.companyId !== requestedCompanyId) {
        throw new Error('Access denied. You can only access your own company data.');
    }
    
    return true;
}

/**
 * Ensures companyId is never extracted from user input (req.body, req.query, req.params)
 * Always uses req.user.companyId
 * @param {Object} req - Express request object
 * @param {string} source - Source to check ('body', 'query', 'params', or 'all')
 * @returns {string|null} - Validated companyId from req.user.companyId
 * @throws {Error} - If companyId is found in user input or missing from user
 */
function ensureCompanyIdFromUser(req, source = 'all') {
    // Check if companyId exists in user input (security risk)
    if (source === 'all' || source === 'body') {
        if (req.body?.companyId !== undefined) {
            throw new Error('SECURITY: companyId cannot be provided in request body. Use authenticated user companyId.');
        }
    }
    
    if (source === 'all' || source === 'query') {
        if (req.query?.companyId !== undefined) {
            throw new Error('SECURITY: companyId cannot be provided in query parameters. Use authenticated user companyId.');
        }
    }
    
    if (source === 'all' || source === 'params') {
        // Allow params.companyId only for specific routes that need it (like /api/company/:companyId)
        // But validate it matches user's companyId
        if (req.params?.companyId && req.path !== '/api/company/:companyId') {
            throw new Error('SECURITY: companyId cannot be provided in route parameters. Use authenticated user companyId.');
        }
    }
    
    // Return companyId from authenticated user
    return validateAndExtractCompanyId(req);
}

/**
 * Validates companyId in service function parameters
 * Ensures companyId is provided and not from user input
 * @param {string} companyId - CompanyId parameter
 * @param {string} functionName - Name of the function (for error messages)
 * @returns {string} - Validated companyId
 * @throws {Error} - If companyId is invalid
 */
function validateServiceCompanyId(companyId, functionName = 'Service function') {
    if (!companyId) {
        throw new Error(`${functionName}: companyId is required and cannot be null or undefined.`);
    }
    
    if (typeof companyId !== 'string' || companyId.trim() === '') {
        throw new Error(`${functionName}: companyId must be a non-empty string.`);
    }
    
    // Basic UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(companyId)) {
        throw new Error(`${functionName}: companyId must be a valid UUID format.`);
    }
    
    return companyId;
}

/**
 * Removes companyId from data object (prevents accidental inclusion)
 * @param {Object} data - Data object that might contain companyId
 * @returns {Object} - Data object with companyId removed
 */
function removeCompanyIdFromData(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }
    
    const cleaned = { ...data };
    delete cleaned.companyId;
    delete cleaned.company_id; // Also remove snake_case version
    
    return cleaned;
}

module.exports = {
    validateAndExtractCompanyId,
    validateCompanyIdAccess,
    ensureCompanyIdFromUser,
    validateServiceCompanyId,
    removeCompanyIdFromData
};

