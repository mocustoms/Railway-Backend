const rateLimit = require('express-rate-limit');
const config = require('../../env');

/**
 * General API rate limiter
 */
const generalRateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000 / 60)
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false, // Disable trust proxy validation - we handle it in Express
    xForwardedForHeader: false // Disable X-Forwarded-For validation
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000 / 60)
    });
  }
});

/**
 * Strict rate limiter for authentication endpoints
 * More lenient in development mode
 */
const authRateLimiter = rateLimit({
  windowMs: config.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  message: {
    error: 'Too many login attempts, please try again later.',
    retryAfter: Math.ceil(config.LOGIN_RATE_LIMIT_WINDOW_MS / 1000 / 60)
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false, // Disable trust proxy validation - we handle it in Express
    xForwardedForHeader: false // Disable X-Forwarded-For validation
  },
  skipSuccessfulRequests: true, // Don't count successful logins
  skip: (req) => {
    // Skip rate limiting entirely in development if DISABLE_RATE_LIMIT is set
    return config.NODE_ENV === 'development' && process.env.DISABLE_RATE_LIMIT === 'true';
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many login attempts, please try again later.',
      retryAfter: Math.ceil(config.LOGIN_RATE_LIMIT_WINDOW_MS / 1000 / 60)
    });
  }
});

/**
 * Registration rate limiter (more strict)
 */
const registrationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Only 3 registration attempts per hour
  message: {
    error: 'Too many registration attempts, please try again later.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false, // Disable trust proxy validation - we handle it in Express
    xForwardedForHeader: false // Disable X-Forwarded-For validation
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many registration attempts, please try again later.',
      retryAfter: 60
    });
  }
});

/**
 * Password reset rate limiter
 */
const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Only 3 password reset attempts per hour
  message: {
    error: 'Too many password reset attempts, please try again later.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false, // Disable trust proxy validation - we handle it in Express
    xForwardedForHeader: false // Disable X-Forwarded-For validation
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many password reset attempts, please try again later.',
      retryAfter: 60
    });
  }
});

/**
 * File upload rate limiter
 */
const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 uploads per 15 minutes
  message: {
    error: 'Too many file uploads, please try again later.',
    retryAfter: 15
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false, // Disable trust proxy validation - we handle it in Express
    xForwardedForHeader: false // Disable X-Forwarded-For validation
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many file uploads, please try again later.',
      retryAfter: 15
    });
  }
});

/**
 * Admin endpoints rate limiter
 */
const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per 15 minutes for admin endpoints
  message: {
    error: 'Too many admin requests, please try again later.',
    retryAfter: 15
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false, // Disable trust proxy validation - we handle it in Express
    xForwardedForHeader: false // Disable X-Forwarded-For validation
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many admin requests, please try again later.',
      retryAfter: 15
    });
  }
});

module.exports = {
  generalRateLimiter,
  authRateLimiter,
  registrationRateLimiter,
  passwordResetRateLimiter,
  uploadRateLimiter,
  adminRateLimiter
}; 