const CookieService = require('../utils/cookieService');

/**
 * CSRF Protection Middleware
 * Validates CSRF tokens for state-changing requests
 */
const csrfProtection = (req, res, next) => {
  // Only check CSRF for state-changing methods
  const stateChangingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  
  if (!stateChangingMethods.includes(req.method)) {
    return next();
  }

  // Skip CSRF check for public authentication endpoints (they handle their own CSRF)
  // Note: /api/auth/register-company requires authentication and CSRF protection
  const publicAuthEndpoints = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/csrf-token'];
  if (publicAuthEndpoints.includes(req.path)) {
    return next();
  }

  // Validate CSRF token
  const isValid = CookieService.validateCSRFToken(req);
  
  if (!isValid) {
    return res.status(403).json({
      error: 'CSRF token validation failed',
      message: 'Invalid or missing CSRF token'
    });
  }

  next();
};

/**
 * CSRF Token Generator Middleware
 * Generates and sets CSRF token for GET requests
 */
const generateCSRFToken = (req, res, next) => {
  // Only generate CSRF token for GET requests
  if (req.method !== 'GET') {
    return next();
  }

  // Check if CSRF token already exists
  const existingToken = CookieService.getCSRFToken(req);
  if (!existingToken) {
    // Generate new CSRF token
    const csrfToken = CookieService.generateCSRFToken();
    CookieService.setCookie(res, 'csrf_token', csrfToken, {
      httpOnly: false, // CSRF token needs to be accessible by JavaScript
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 day
    });
  }

  next();
};

/**
 * CSRF Token Refresh Middleware
 * Refreshes CSRF token on successful authentication
 */
const refreshCSRFToken = (req, res, next) => {
  // Generate new CSRF token after successful authentication
  const csrfToken = CookieService.generateCSRFToken();
  CookieService.setCookie(res, 'csrf_token', csrfToken, {
    httpOnly: false,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 day
  });

  next();
};

module.exports = {
  csrfProtection,
  generateCSRFToken,
  refreshCSRFToken
}; 