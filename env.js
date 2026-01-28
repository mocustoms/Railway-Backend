// Server Environment Configuration
const path = require("path");

// Explicitly load .env from backend directory
// This ensures the correct .env file is loaded regardless of where the script is run from
const envPath = path.resolve(__dirname, ".env");
require("dotenv").config({ path: envPath });

/**
 * Parse DATABASE_URL if provided (common in PaaS platforms like Railway, Heroku, Render, etc.)
 *
 * This is the SINGLE SOURCE OF TRUTH for database configuration.
 * To switch between local and Railway, just change DATABASE_URL in your .env file:
 *
 * Local: DATABASE_URL=postgresql://postgres:password@localhost:5432/easymauzo_pos
 * Railway: DATABASE_URL=postgresql://postgres:password@railway-host:port/railway
 *
 * Or use individual variables: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */

function parseDatabaseUrl(customUrl = null) {
  const config = {
    host: process.env.PGHOST || process.env.DB_HOST || "mauzo-db",
    port: parseInt(process.env.PGPORT || process.env.DB_PORT || "5432"),
    database: process.env.PGDATABASE || process.env.DB_NAME || "easymauzo_pos",
    username: process.env.PGUSER || process.env.DB_USER || "postgres",
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || "postgres",
  };

  if (process.env.NODE_ENV !== "production") {
    console.log("📊 Using individual variables:", {
      host: config.host,
      port: config.port,
      database: config.database,
      username: config.username,
      password: config.password ? "***" : "not set",
    });
  }

  return config;
}

// Parse database configuration (can be overridden by passing custom URL)
const dbConfig = parseDatabaseUrl();

// Set default values if not in .env
const config = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 3000,
  APP_NAME: process.env.APP_NAME || "EasyMauzo POS",
  APP_VERSION: process.env.APP_VERSION || "1.0.0",

  // Database - use parsed values from DATABASE_URL or individual variables
  DB_HOST: dbConfig.host,
  DB_PORT: dbConfig.port,
  DB_NAME: dbConfig.database,
  DB_USER: dbConfig.username,
  DB_PASSWORD: dbConfig.password,
  DB_DIALECT: process.env.DB_DIALECT || "postgres",
  DB_LOGGING: process.env.DB_LOGGING === "true" ? console.log : false,

  // JWT Configuration (set JWT_SECRET and JWT_REFRESH_SECRET in production!)
  JWT_SECRET: process.env.JWT_SECRET || "your-very-secure-jwt-secret-key-2024",
  JWT_REFRESH_SECRET:
    process.env.JWT_REFRESH_SECRET ||
    "your-very-secure-jwt-refresh-secret-key-2024",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m", // Short-lived access tokens
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "7d", // Long-lived refresh tokens
  JWT_ALGORITHM: process.env.JWT_ALGORITHM || "HS256",

  // Cookie Configuration
  COOKIE_SECURE: process.env.NODE_ENV === "production", // HTTPS only in production
  COOKIE_HTTPONLY: true, // Always true for security
  COOKIE_SAMESITE: process.env.NODE_ENV === "production" ? "none" : "lax", // Use 'none' for cross-site cookies in production (required for reverse proxies)
  COOKIE_DOMAIN:
    process.env.NODE_ENV === "production"
      ? process.env.COOKIE_DOMAIN
      : undefined, // Don't set domain in development

  // Security
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 10,
  SESSION_SECRET: process.env.SESSION_SECRET || "your_session_secret_here",
  // CORS: When frontend is on a different domain (e.g. Railway), set this to the frontend URL(s).
  // Comma-separated: "https://your-frontend.up.railway.app,https://staging.up.railway.app"
  // Use "*" only if you don't need cookies/credentials; with credentials, "*" is reflected as request origin.
  CORS_ORIGIN:
    process.env.CORS_ORIGIN ||
    (process.env.NODE_ENV === "production" ? "*" : "http://localhost:3002"),

  // Rate Limiting
  // More lenient in development, stricter in production
  RATE_LIMIT_WINDOW_MS:
    parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS:
    parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) ||
    (process.env.NODE_ENV === "production" ? 100 : 1000),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS:
    parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) ||
    (process.env.NODE_ENV === "production" ? 5 : 100),
  LOGIN_RATE_LIMIT_WINDOW_MS:
    parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes

  // Email
  SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
  SMTP_PORT: process.env.SMTP_PORT || 587,
  SMTP_USER: process.env.SMTP_USER || "your_email@gmail.com",
  SMTP_PASS: process.env.SMTP_PASS || "your_email_password_or_app_password",
  EMAIL_FROM: process.env.EMAIL_FROM || "noreply@easymauzo.com",

  // File Upload (partition for photos: set UPLOAD_PATH to Railway Volume mount, e.g. /data)
  UPLOAD_PATH: process.env.UPLOAD_PATH || "uploads/",
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 5242880,
  ALLOWED_FILE_TYPES:
    process.env.ALLOWED_FILE_TYPES || "image/jpeg,image/png,image/gif",

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || "debug",
  LOG_FILE: process.env.LOG_FILE || "logs/app.log",
};

// Production: warn if default JWT secrets are used (set JWT_SECRET + JWT_REFRESH_SECRET in env)
if (config.NODE_ENV === "production") {
  const defaultJwt = "your-very-secure-jwt-secret-key-2024";
  if (config.JWT_SECRET === defaultJwt || config.JWT_REFRESH_SECRET === defaultJwt) {
    console.warn("⚠️  SECURITY: JWT_SECRET and/or JWT_REFRESH_SECRET are using defaults. Set them in production (e.g. Railway Variables).");
  }
}

config.parseDatabaseUrl = parseDatabaseUrl;
module.exports = config;
