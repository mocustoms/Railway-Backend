const helmet = require('helmet');

// Security middleware: helmet with CSP disabled so cross-origin API + SPA still work.
// We still get: HSTS, noSniff, referrerPolicy, frameguard, X-Powered-By removal.
const securityMiddleware = helmet({
    contentSecurityPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' }
});

// Additional security headers (CORS is configured in server.js)
const additionalSecurityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.removeHeader('X-Powered-By');
    next();
};

module.exports = {
    securityMiddleware,
    additionalSecurityHeaders
}; 