const config = require('../../env');

// In-memory cache of recently-issued CSRF tokens for cross-origin (e.g. Railway frontend).
// When the browser doesn't send the csrf_token cookie (different origin), we accept
// the token from X-CSRF-Token header if it was recently issued by us.
const CSRF_ISSUED_TTL_MS = 60 * 60 * 1000; // 1 hour
const csrfIssuedCache = new Map(); // token -> expiry timestamp

function pruneExpiredCSRFTokens() {
  const now = Date.now();
  for (const [token, expiry] of csrfIssuedCache.entries()) {
    if (expiry < now) csrfIssuedCache.delete(token);
  }
}

class CookieService {
  /**
   * Set secure authentication cookies
   */
  static setAuthCookies(res, accessToken, refreshToken, rememberMe = false) {
    const cookieOptions = {
      httpOnly: config.COOKIE_HTTPONLY,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      path: '/'
    };
    
    // Only set domain if it's explicitly configured (don't set for Railway default domains)
    if (config.COOKIE_DOMAIN) {
      cookieOptions.domain = config.COOKIE_DOMAIN;
    }

    // Access token cookie (short-lived)
    const accessTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      expires: accessTokenExpiry
    });

    // Refresh token cookie (long-lived)
    const refreshTokenExpiry = rememberMe 
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
    
    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      expires: refreshTokenExpiry
    });

    // CSRF token cookie (also register for header-only validation when cookie isn't sent cross-origin)
    const csrfToken = this.generateCSRFToken();
    this.registerIssuedCSRFToken(csrfToken);
    res.cookie('csrf_token', csrfToken, {
      ...cookieOptions,
      expires: refreshTokenExpiry,
      httpOnly: false // CSRF token needs to be accessible by JavaScript
    });

    return csrfToken;
  }

  /**
   * Clear authentication cookies
   */
  static clearAuthCookies(res) {
    const cookieOptions = {
      httpOnly: config.COOKIE_HTTPONLY,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      path: '/',
      expires: new Date(0)
    };
    
    // Only set domain if it's explicitly configured
    if (config.COOKIE_DOMAIN) {
      cookieOptions.domain = config.COOKIE_DOMAIN;
    }

    res.cookie('access_token', '', cookieOptions);
    res.cookie('refresh_token', '', cookieOptions);
    res.cookie('csrf_token', '', cookieOptions);
  }

  /**
   * Get access token from cookies
   */
  static getAccessToken(req) {
    return req.cookies?.access_token || null;
  }

  /**
   * Get refresh token from cookies
   */
  static getRefreshToken(req) {
    return req.cookies?.refresh_token || null;
  }

  /**
   * Get CSRF token from cookies
   */
  static getCSRFToken(req) {
    return req.cookies?.csrf_token || null;
  }

  /**
   * Register a CSRF token as recently issued (for header-only validation when cookie isn't sent cross-origin).
   * Used when frontend and backend are on different origins (e.g. Railway).
   */
  static registerIssuedCSRFToken(token) {
    if (!token || typeof token !== 'string') return;
    csrfIssuedCache.set(token, Date.now() + CSRF_ISSUED_TTL_MS);
    if (csrfIssuedCache.size > 10000) pruneExpiredCSRFTokens();
  }

  /**
   * Validate CSRF token (cookie vs header, or header-only if token was recently issued by us).
   * Header-only fallback fixes "CSRF token validation failed" when frontend is on a different
   * origin (e.g. Railway) and the browser does not send the csrf_token cookie.
   */
  static validateCSRFToken(req) {
    const cookieToken = this.getCSRFToken(req);
    const headerToken = req.headers['x-csrf-token'] || req.headers['csrf-token'];

    if (cookieToken && headerToken && cookieToken === headerToken) {
      return true;
    }
    // Fallback: cookie missing (cross-origin) but token in header was recently issued by us
    if (!cookieToken && headerToken && headerToken.length === 64 && /^[a-f0-9]+$/i.test(headerToken)) {
      pruneExpiredCSRFTokens();
      const expiry = csrfIssuedCache.get(headerToken);
      if (expiry && expiry > Date.now()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Generate CSRF token
   */
  static generateCSRFToken() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  /**
   * Set a single cookie with secure options
   */
  static setCookie(res, name, value, options = {}) {
    const defaultOptions = {
      httpOnly: config.COOKIE_HTTPONLY,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      path: '/'
    };
    
    // Only set domain if it's explicitly configured
    if (config.COOKIE_DOMAIN) {
      defaultOptions.domain = config.COOKIE_DOMAIN;
    }

    res.cookie(name, value, { ...defaultOptions, ...options });
  }

  /**
   * Clear a specific cookie
   */
  static clearCookie(res, name) {
    const cookieOptions = {
      httpOnly: config.COOKIE_HTTPONLY,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      path: '/',
      expires: new Date(0)
    };
    
    // Only set domain if it's explicitly configured
    if (config.COOKIE_DOMAIN) {
      cookieOptions.domain = config.COOKIE_DOMAIN;
    }

    res.cookie(name, '', cookieOptions);
  }
}

module.exports = CookieService; 