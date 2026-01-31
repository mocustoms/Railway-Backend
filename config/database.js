const { Sequelize } = require("sequelize");
const config = require("../env");

/**
 * Create Sequelize database connection
 *
 * This is the SINGLE POINT OF CONNECTION for the application.
 * It uses DATABASE_URL from environment variables or falls back to individual DB_* variables.
 *
 * To switch between local and Railway, just change DATABASE_URL in your .env file.
 *
 * For scripts that need to connect to a different database, use createDatabaseConnection()
 */
const dbConfig = {
  database: config.DB_NAME,
  username: config.DB_USER,
  password: config.DB_PASSWORD,
  host: config.DB_HOST,
  port: config.DB_PORT,
  dialect: "postgres",
  logging: config.DB_LOGGING === "true" ? console.log : false,
  pool: {
    max: 20,
    min: 2,
    acquire: 60000,
    idle: 30000,
  },
  retry: {
    max: 3,
    match: [
      /ETIMEDOUT/,
      /EHOSTUNREACH/,
      /ECONNREFUSED/,
      /ECONNRESET/,
      /ETIMEDOUT/,
      /ESOCKETTIMEDOUT/,
      /EHOSTUNREACH/,
      /EPIPE/,
      /EAI_AGAIN/,
      /SequelizeConnectionError/,
      /SequelizeConnectionRefusedError/,
      /SequelizeHostNotFoundError/,
      /SequelizeHostNotReachableError/,
      /SequelizeInvalidConnectionError/,
      /SequelizeConnectionTimedOutError/,
    ],
  },
  dialectOptions: {
    connectTimeout: 10000, // 10 seconds
    // Railway and other PaaS require SSL for Postgres. Disable for local/Docker (localhost, mauzo-db, etc.)
    // Set DB_SSL=false in .env to force no SSL; DB_SSL=true to force SSL.
    ssl: (() => {
      if (process.env.DB_SSL === "false" || process.env.DB_SSL === "0") return false;
      if (process.env.DB_SSL === "true" || process.env.DB_SSL === "1") {
        return { require: true, rejectUnauthorized: false };
      }
      const localHosts = ["localhost", "127.0.0.1", "mauzo-db", "db", "postgres"];
      const isLocal = !config.DB_HOST || localHosts.includes(config.DB_HOST);
      return isLocal
        ? false
        : { require: true, rejectUnauthorized: false };
    })(),
  },
};

const sequelize = new Sequelize(dbConfig);

// Test the database connection (non-blocking, with better error handling)
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connection has been established successfully.");
    return true;
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error.message);
    console.error("   Error details:", {
      name: error.name,
      code: error.original?.code || error.code,
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      username: config.DB_USER,
    });
    // Don't throw - let the server start and handle connection errors gracefully
    return false;
  }
}

// Run the connection test (non-blocking)
testConnection().catch((err) => {
  console.error("Database connection test failed:", err.message);
});

/**
 * Create a Sequelize connection for a custom DATABASE_URL
 * Useful for scripts that need to connect to different databases (e.g., sync scripts)
 *
 * @param {string} databaseUrl - Full PostgreSQL connection URL
 * @returns {Sequelize} Sequelize instance
 */
function createDatabaseConnection(databaseUrl) {
  // Parse the custom URL using the centralized parser
  const customConfig = config.parseDatabaseUrl(databaseUrl);

  const customDbConfig = {
    database: customConfig.database,
    username: customConfig.username,
    password: customConfig.password,
    host: customConfig.host,
    port: customConfig.port,
    dialect: "postgres",
    logging: false,
    pool: {
      max: 10,
      min: 1,
      acquire: 60000,
      idle: 30000,
    },
    dialectOptions: {
      connectTimeout: 10000,
      ssl: (() => {
        const localHosts = ["localhost", "127.0.0.1", "mauzo-db", "db", "postgres"];
        const isLocal = !customConfig.host || localHosts.includes(customConfig.host);
        return isLocal ? false : { require: true, rejectUnauthorized: false };
      })(),
    },
  };

  return new Sequelize(customDbConfig);
}

module.exports = sequelize;
module.exports.createDatabaseConnection = createDatabaseConnection;
