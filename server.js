const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const config = require("./env");

// Import and establish database connection
const sequelize = require("./config/database");

// Import routes
const accountRouter = require("./server/routes/account");
const openingBalanceRouter = require("./server/routes/openingBalance");
const journalEntryRouter = require("./server/routes/journalEntry");
const financialYearRouter = require("./server/routes/financialYear");
const storeRouter = require("./server/routes/store");
const authRouter = require("./server/routes/auth");
const companyRouter = require("./server/routes/company");
const userRouter = require("./server/routes/user");
const paymentMethodRouter = require("./server/routes/paymentMethod");
const paymentTypeRouter = require("./server/routes/paymentType");
const bankDetailRouter = require("./server/routes/bankDetail");
const customerDepositRouter = require("./server/routes/customerDeposit");
const taxCodeRouter = require("./server/routes/taxCode");
const productCategoryRouter = require("./server/routes/productCategory");
const productColorRouter = require("./server/routes/productColor");
const productModelRouter = require("./server/routes/productModel");
const productStoreLocationRouter = require("./server/routes/productStoreLocation");
const packagingRouter = require("./server/routes/packaging");
const priceCategoryRouter = require("./server/routes/priceCategory");
const productManufacturerRouter = require("./server/routes/productManufacturer");
const productBrandNameRouter = require("./server/routes/productBrandName");
const productRouter = require("./server/routes/product");
const salesAgentRouter = require("./server/routes/salesAgent");
const customerGroupRouter = require("./server/routes/customerGroup");
const customerRouter = require("./server/routes/customer");
const customerImportRouter = require("./server/routes/customerImport");
const customerDepositImportRouter = require("./server/routes/customerDepositImport");
const loyaltyCardRouter = require("./server/routes/loyaltyCard");
const loyaltyCardConfigRouter = require("./server/routes/loyaltyCardConfig");
const loyaltyConfigRouter = require("./server/routes/loyaltyConfig");

const manufacturingRouter = require("./server/routes/manufacturing");
const priceHistoryRouter = require("./server/routes/priceHistory");
const adjustmentReasonRoutes = require("./server/routes/adjustmentReason");
const adjustmentReasonStatsRoutes = require("./server/routes/adjustmentReasonStats");
const returnReasonRoutes = require("./server/routes/returnReason");
const proformaInvoiceRoutes = require("./server/routes/proformaInvoice");
const salesOrderRoutes = require("./server/routes/salesOrder");
const salesInvoiceRoutes = require("./server/routes/salesInvoice");
const receiptRoutes = require("./server/routes/receipt");
const salesTransactionRoutes = require("./server/routes/salesTransaction");
const physicalInventoryRoutes = require("./server/routes/physicalInventory");
const stockBalanceRouter = require("./server/routes/stockBalance");
const stockAdjustmentRoutes = require("./server/routes/stockAdjustment");
const returnOutRoutes = require("./server/routes/returnOut");
const purchaseOrderRoutes = require("./server/routes/purchaseOrder");
const purchaseInvoiceRoutes = require('./server/routes/purchaseInvoice');
const purchaseInvoicePaymentRoutes = require('./server/routes/purchaseInvoicePayment');
const storeRequestRoutes = require("./server/routes/storeRequest");
const customerListReportRouter = require("./server/routes/customerListReport");
const customerBirthdaysReportRouter = require("./server/routes/customerBirthdaysReport");
const administrationRouter = require("./server/routes/administration");
const currencyRouter = require("./server/routes/currency");
const vendorGroupRouter = require("./server/routes/vendorGroup");
const runMigrations = require("./scripts/run-migrations").runMigrations;
const auth = require("./server/middleware/auth");

// Import CSRF middleware
const {
  generateCSRFToken,
  csrfProtection,
} = require("./server/middleware/csrfProtection");

// Import pharmaceutical routes with error handling
let pharmaceuticalRouter;
try {
  pharmaceuticalRouter = require("./server/routes/pharmaceutical");
} catch (error) {
  // Create a basic router as fallback
  pharmaceuticalRouter = express.Router();
  pharmaceuticalRouter.get("*", (req, res) => {
    res.status(404).json({ error: "Pharmaceutical routes not available" });
  });
  pharmaceuticalRouter.post("*", (req, res) => {
    res.status(404).json({ error: "Pharmaceutical routes not available" });
  });
}

const app = express();

// Trust proxy - Required for reverse proxies (Railway, Nginx, etc.)
// In production: trust proxy (Railway uses reverse proxy)
// In development: don't trust proxy (or trust only localhost)
// Setting to true means: trust all proxies (needed for Railway)
// Setting to 1 means: trust only the first proxy hop (more secure but may not work with Railway)
app.set("trust proxy", config.NODE_ENV === "production" ? true : false);

// CORS configuration
// Support multiple origins (comma-separated) or wildcard for production deployments
const corsOrigin = config.CORS_ORIGIN;
let corsOriginValue;

if (corsOrigin === "*" || config.NODE_ENV === "production") {
  // In production, allow all origins or use function to check
  corsOriginValue =
    corsOrigin === "*"
      ? true // Allow all origins
      : (origin, callback) => {
          // Support comma-separated origins
          const allowedOrigins = corsOrigin.split(",").map((o) => o.trim());
          if (
            !origin ||
            allowedOrigins.includes(origin) ||
            allowedOrigins.includes("*")
          ) {
            callback(null, true);
          } else {
            callback(new Error("Not allowed by CORS"));
          }
        };
} else {
  corsOriginValue = corsOrigin;
}

const corsOptions = {
  origin: corsOriginValue,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-CSRF-Token",
    "CSRF-Token",
  ],
};

// Middleware
app.use(cors(corsOptions));
app.use(cookieParser()); // Parse cookies
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Serve static files from uploads directory BEFORE CSRF protection
// Static files don't need CSRF tokens
// __dirname is backend/, so uploads is in the same directory
const uploadsPath = path.join(__dirname, "uploads");
const fs = require("fs");

// Log uploads path for debugging (especially on Railway)
// Only log in production if DETAILED_LOGGING is enabled to reduce noise
if (
  config.NODE_ENV === "production" &&
  process.env.DETAILED_LOGGING === "true"
) {
  console.log(`📁 Using uploads directory: ${uploadsPath}`);
  console.log(`📁 Current working directory: ${process.cwd()}`);
}

// Ensure uploads directory exists
if (!fs.existsSync(uploadsPath)) {
  console.log(`⚠️  Uploads directory does not exist, creating: ${uploadsPath}`);
  try {
    fs.mkdirSync(uploadsPath, { recursive: true });
    console.log(`✅ Created uploads directory: ${uploadsPath}`);
  } catch (error) {
    console.error(`❌ Failed to create uploads directory: ${error.message}`);
    if (config.NODE_ENV === "production") {
      console.error(`   This may indicate a volume mount issue on Railway.`);
    }
  }
}

// Serve static files from uploads directory BEFORE CSRF protection
// Static files don't need CSRF tokens
// This must come before the catch-all route in production
app.use(
  "/uploads",
  (req, res, next) => {
    // Handle malformed URLs (like https:/placehold.co - missing slash)
    // If the path looks like a URL, return 404 gracefully
    if (req.path.includes("://") || req.path.startsWith("http")) {
      return res.status(404).json({ error: "Invalid file path" });
    }

    next();
  },
  express.static(uploadsPath, {
    maxAge: "1y", // Cache uploaded files for 1 year
    etag: true,
    lastModified: true,
    fallthrough: true, // Allow fallthrough to handle missing files gracefully
  }),
  (req, res, next) => {
    // Handle missing files gracefully - return 404 without crashing
    if (req.path.startsWith("/uploads/")) {
      return res.status(404).json({
        error: "File not found",
        path: req.path,
        message:
          "The requested file does not exist. This may occur if files were uploaded before a deployment, as Railway uses an ephemeral filesystem.",
      });
    }
    next();
  }
);

// CSRF Protection
app.use(generateCSRFToken); // Generate CSRF tokens for GET requests
app.use(csrfProtection); // Validate CSRF tokens for state-changing requests

// List all registered routes
const listRoutes = (app) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // Routes registered directly on the app
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods),
      });
    } else if (middleware.name === "router") {
      // Router middleware
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push({
            path: handler.route.path,
            methods: Object.keys(handler.route.methods),
          });
        }
      });
    }
  });
  return routes;
};

// Register API routes
// Auth routes
app.use("/api/auth", authRouter);

// Company routes
app.use("/api/company", companyRouter);

// Linked Accounts routes
const linkedAccountRouter = require("./server/routes/linkedAccount");
const { table } = require("console");
app.use("/api/linked-accounts", linkedAccountRouter);

// User routes
app.use("/api/users", userRouter);

// Store routes
app.use("/api/stores", storeRouter);

// Account routes
app.use("/api/accounts", accountRouter);

// Opening balance routes
app.use("/api/opening-balances", openingBalanceRouter);

// Journal entry routes
app.use("/api/journal-entries", journalEntryRouter);

// Financial year routes
app.use("/api/financial-years", financialYearRouter);

// Payment method routes
app.use("/api/payment-methods", paymentMethodRouter);

// Payment type routes
app.use("/api/payment-types", paymentTypeRouter);

// Bank detail routes
app.use("/api/bank-details", bankDetailRouter);
app.use("/api/customer-deposits", customerDepositRouter);

// Tax code routes
app.use("/api/tax-codes", taxCodeRouter);

// Product category routes
app.use("/api/product-categories", productCategoryRouter);

// Product color routes
app.use("/api/product-colors", productColorRouter);

// Product model routes
app.use("/api/product-models", productModelRouter);

// Product store location routes
app.use("/api/product-store-locations", productStoreLocationRouter);

// Packaging routes
app.use("/api/packaging", packagingRouter);

// Price category routes
app.use("/api/price-categories", priceCategoryRouter);

// Product manufacturer routes
app.use("/api/product-manufacturers", productManufacturerRouter);

// Product brand name routes
app.use("/api/product-brand-names", productBrandNameRouter);

// Product routes
app.use("/api/products", productRouter);

// Sales agent routes
app.use("/api/sales-agents", salesAgentRouter);
app.use("/api/customer-groups", customerGroupRouter);
app.use("/api/customers", customerRouter);
app.use("/api/customers/import", customerImportRouter);

// Customer deposit import routes
app.use("/api/customer-deposits/import", customerDepositImportRouter);

// Loyalty card routes
app.use("/api/loyalty-cards", loyaltyCardRouter);
app.use("/api/loyalty-card-configs", loyaltyCardConfigRouter);
app.use("/api/loyalty-config", loyaltyConfigRouter);

// Product import routes
app.use("/api/products/import", require("./server/routes/productImport"));

// Manufacturing routes
app.use("/api/manufacturing", manufacturingRouter);

// Price history routes
app.use("/api/price-history", priceHistoryRouter);

// Adjustment reason routes
app.use("/api/adjustment-reasons", adjustmentReasonRoutes);
app.use("/api/adjustment-reason-stats", adjustmentReasonStatsRoutes);

// Return reason routes
app.use("/api/return-reasons", returnReasonRoutes);

// Proforma invoice routes
app.use("/api/proforma-invoices", proformaInvoiceRoutes);
app.use("/api/sales-orders", salesOrderRoutes);
app.use("/api/sales-invoices", salesInvoiceRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/sales-transactions", salesTransactionRoutes);

// Stock adjustment routes
app.use("/api/stock-adjustments", stockAdjustmentRoutes);

// Returns Out routes
app.use('/api/returns-out', returnOutRoutes);
  app.use('/api/purchase-orders', purchaseOrderRoutes);
  app.use('/api/purchase-invoices', purchaseInvoiceRoutes);
  app.use('/api/purchase-invoice-payments', purchaseInvoicePaymentRoutes);

// Store request routes
app.use("/api/store-requests", storeRequestRoutes);

// Physical inventory routes
app.use("/api/physical-inventories", physicalInventoryRoutes);

// Stock balance routes
app.use("/api/stock-balance", stockBalanceRouter);

// Customer list report routes
app.use("/api/customer-list-report", customerListReportRouter);

// Customer birthdays report routes
app.use("/api/customer-birthdays-report", customerBirthdaysReportRouter);

// Revenue report routes
app.use("/api/revenue-report", require("./server/routes/revenueReport"));

// Sales details report routes
app.use(
  "/api/sales-details-report",
  require("./server/routes/salesDetailsReport")
);

// Trial balance report routes
app.use(
  "/api/trial-balance-report",
  require("./server/routes/trialBalanceReport")
);

// Administration routes
app.use("/api/administration", auth, administrationRouter);

// Database configuration routes (system admin only)
app.use("/api/database-config", require("./server/routes/databaseConfig"));

// Pharmaceutical routes
app.use("/api/pharmaceutical", pharmaceuticalRouter);

// Auto code routes
app.use("/api/auto-codes", require("./server/routes/autoCode"));

// Exchange rate routes
app.use("/api/exchange-rates", require("./server/routes/exchangeRate"));

// Currency routes
app.use("/api/currency", currencyRouter);

// Serial batch search routes
app.use("/api/serial-batch", require("./server/routes/serialBatchSearch"));

// Trial balance routes
app.use("/api/trial-balance", require("./server/routes/trialBalance"));

// Scheduler management routes
app.use("/api/schedulers", require("./server/routes/scheduler"));

// App version route (public, no auth required)
app.use("/api/app-version", require("./server/routes/appVersion"));

app.use("/api/vendor-groups", vendorGroupRouter);

app.use("/api/vendors", require("./server/routes/vendor"));

app.use("/api/returns-out-reasons", require("./server/routes/returnReason"));
app.use('/api/returns-out',require("./server/routes/returnOut"));
app.use('/api/purchasing-orders',require("./server/routes/purchaseOrder"));
app.use('/api/purchase-invoices',require("./server/routes/purchaseInvoice"));
app.use('/api/purchasing-invoice-payments',require("./server/routes/purchaseInvoicePayment"));

// Enhanced health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    // Test database connection
    await sequelize.authenticate();

    const healthData = {
      status: "OK",
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      version: config.APP_VERSION,
      database: "Connected",
      uptime: process.uptime(),
      message: "Server is running",
    };

    // Optionally include schema verification (if ?schema=true query param)
    if (req.query.schema === "true") {
      try {
        const {
          verifyDatabaseSchema,
        } = require("./server/utils/databaseSchemaVerifier");
        const schemaResults = await verifyDatabaseSchema({
          verbose: false,
          failOnError: false,
          skipExtraColumns: true,
        });
        healthData.schema = {
          verified: schemaResults.verified,
          tablesChecked: schemaResults.tablesChecked,
          errors: schemaResults.errors.length,
          warnings: schemaResults.warnings.length,
        };
      } catch (schemaError) {
        healthData.schema = {
          verified: false,
          error: schemaError.message,
        };
      }
    }

    res.json(healthData);
  } catch (error) {
    res.status(503).json({
      status: "ERROR",
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      version: config.APP_VERSION,
      database: "Disconnected",
      error: error.message,
      message: "Server is running but database connection failed",
    });
  }
});

// Serve React build files in production
// Note: Railway should set NODE_ENV=production, but we'll also check for Railway-specific env vars
const isProduction =
  config.NODE_ENV === "production" ||
  process.env.RAILWAY_ENVIRONMENT === "production" ||
  process.env.RAILWAY_ENVIRONMENT_NAME;

if (isProduction) {
  // Try multiple possible build locations
  // In production: __dirname = /app/backend (where server.js is located)
  // process.cwd() = /app/backend (working directory when server starts)
  // Build is created at: /app/frontend/build (when running "cd frontend && npm run build")
  // So from __dirname (/app/backend), go up 1 level to /app, then add 'frontend/build'
  const possibleBuildPaths = [
    path.join(__dirname, "..", "frontend", "build"), // /app/backend/../frontend/build = /app/frontend/build
    path.join(process.cwd(), "..", "frontend", "build"), // /app/backend/../frontend/build = /app/frontend/build
    path.resolve(__dirname, "../frontend/build"), // Absolute path version
    path.join(process.cwd(), "build"), // Fallback: /app/backend/build (unlikely but check anyway)
    path.join(__dirname, "..", "build"), // Fallback: /app/build (if build is at root)
  ];

  let buildPath = null;
  for (const possiblePath of possibleBuildPaths) {
    if (fs.existsSync(possiblePath)) {
      buildPath = possiblePath;
      break;
    }
  }

  if (!buildPath) {
    console.error(`❌ Build directory not found in any expected location!`);
    console.error(`   Checked paths: ${possibleBuildPaths.join(", ")}`);
    console.error(
      `   Please check Railway build logs to ensure 'npm run build' completed successfully.`
    );
    buildPath = path.join(__dirname, "..", "frontend", "build"); // Fallback to default
  }

  // Check for index.html specifically
  const indexPath = path.join(buildPath, "index.html");
  if (!fs.existsSync(indexPath)) {
    console.error(`❌ index.html NOT found in build directory!`);
  }

  // Serve static files from build directory (images, CSS, JS, etc.)
  // This must come BEFORE the catch-all route
  app.use(
    express.static(buildPath, {
      maxAge: "1y", // Cache static assets for 1 year
      etag: true,
      lastModified: true,
      fallthrough: true, // Allow falling through to next middleware if file not found
    })
  );

  // Serve React app for all non-API routes (catch-all must be last)
  // This handles client-side routing - all non-API GET requests serve index.html
  app.get("*", (req, res) => {
    // Skip API routes - they should have been handled by API middleware above
    if (req.path.startsWith("/api/")) {
      // If we reach here, it means no API route matched - return 404
      return res
        .status(404)
        .json({ error: "API endpoint not found", path: req.path });
    }

    // Skip /uploads routes - they should have been handled by express.static above
    if (req.path.startsWith("/uploads/")) {
      // If we reach here, the file doesn't exist in uploads directory
      // Return JSON response for API consistency
      return res.status(404).json({
        error: "File not found",
        path: req.path,
        message:
          "The requested file does not exist. This may occur if files were uploaded before a deployment, as Railway uses an ephemeral filesystem.",
      });
    }

    // Skip static file requests (they should have been handled by express.static above)
    // This includes /static/, /favicon.ico, /manifest.json, etc.
    if (
      req.path.match(
        /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|json|pdf)$/i
      )
    ) {
      return res.status(404).send("Static file not found");
    }

    // For all other routes, serve the React app (index.html)
    // This enables client-side routing (React Router)
    const indexPath = path.join(buildPath, "index.html");

    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath, (err) => {
        if (err && !res.headersSent) {
          res.status(500).send("Error serving React app");
        }
      });
    } else {
      if (!res.headersSent) {
        res.status(404).send("React app not built. Please run npm run build.");
      }
    }
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  // Log all errors for debugging
  console.error("\n❌ ERROR OCCURRED:");
  console.error("Path:", req.path);
  console.error("Method:", req.method);
  console.error("Error Name:", err.name);
  console.error("Error Message:", err.message);
  if (config.NODE_ENV === "development") {
    console.error("Stack:", err.stack);
    if (err.original) {
      console.error("Original Error:", err.original);
    }
  }
  console.error("---\n");

  // Handle Sequelize connection errors
  if (
    err.name === "SequelizeConnectionError" ||
    err.name === "SequelizeConnectionRefusedError" ||
    err.name === "SequelizeHostNotFoundError" ||
    err.name === "SequelizeHostNotReachableError" ||
    err.name === "SequelizeInvalidConnectionError" ||
    err.name === "SequelizeConnectionTimedOutError" ||
    err.original?.code === "ECONNREFUSED" ||
    err.original?.code === "ETIMEDOUT" ||
    err.original?.code === "EHOSTUNREACH"
  ) {
    console.error("Database connection error:", err.message);
    if (req.path.startsWith("/api/")) {
      return res.status(503).json({
        error: "Database connection error",
        message:
          "Unable to connect to the database. Please check your database configuration and ensure PostgreSQL is running.",
        details: config.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  }

  // Handle Sequelize validation errors
  if (err.name === "SequelizeValidationError") {
    const errors =
      err.errors?.map((e) => ({
        field: e.path,
        message: e.message,
      })) || [];

    if (req.path.startsWith("/api/")) {
      return res.status(400).json({
        error: "Validation error",
        message: "Invalid input data",
        errors: errors.map((e) => e.message),
        errorDetails: config.NODE_ENV === "development" ? errors : undefined,
      });
    }
  }

  // Handle Sequelize unique constraint errors
  if (err.name === "SequelizeUniqueConstraintError") {
    if (req.path.startsWith("/api/")) {
      return res.status(409).json({
        error: "Duplicate entry",
        message: "A record with this information already exists",
        details: config.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  }

  // Only send JSON for API routes
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({
      error: "Something went wrong!",
      message: config.NODE_ENV === "development" ? err.message : undefined,
      stack: config.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
  next(err);
});

const startServer = async (port) => {
  try {
    // Test database connection before starting server
    try {
      await sequelize.authenticate();
      console.log("✅ Database connection verified");
      const qi = sequelize.getQueryInterface();

      const tables = await qi.sequelize.query(
         `
             SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public';
         `,
        { type: sequelize.QueryTypes.SELECT }
      );
      if (tables.length < 2) {
        await sequelize.sync({ alter: false, force: false }); // Ensure models are synced
        console.log("✅ Database synchronized");
      } else {
        console.log("ℹ️ Database already initialized, skipping sync");
      }
      // Verify database schema if enabled (set VERIFY_SCHEMA_ON_STARTUP=true)
      if (process.env.VERIFY_SCHEMA_ON_STARTUP === "true") {
        console.log("🔍 Verifying database schema on startup...");
        try {
          console.log("\n🔍 Verifying database schema...");
          const {
            verifyDatabaseSchema,
          } = require("./server/utils/databaseSchemaVerifier");
          const schemaResults = await verifyDatabaseSchema({
            verbose: false,
            failOnError: false,
            skipExtraColumns: true,
          });

          if (!schemaResults.verified) {
            console.warn(
              '⚠️  Schema verification found issues. Run "npm run verify-schema" for details.'
            );
            if (schemaResults.errors.length > 0) {
              console.warn(
                `   Found ${schemaResults.errors.length} errors that need attention.`
              );
            }
          } else {
            console.log("✅ Database schema verified successfully");
          }
        } catch (schemaError) {
          console.warn("⚠️  Schema verification failed:", schemaError.message);
          console.warn(
            "   Server will continue, but you should verify the schema manually."
          );
        }
      }
        // Run pending migrations
        await runMigrations();

      // System initialization disabled - data creation scripts removed for Railway deployment
      // To create admin user manually, run: node scripts/seedAdminUser.js
      // const systemInitializer = require('./server/utils/systemInitializer');
      // const initResult = await systemInitializer.initializeSystem();
    } catch (dbError) {
      console.error("❌ Database connection failed:", dbError.message);
      console.error(
        "   Please check your database configuration and ensure PostgreSQL is running"
      );
      console.error("   Configuration:", {
        host: config.DB_HOST,
        port: config.DB_PORT,
        database: config.DB_NAME,
        username: config.DB_USER,
      });
      // Continue starting server - routes will handle connection errors gracefully
      console.warn(
        "⚠️  Starting server anyway - database connection will be retried on first request"
      );
    }

    // Initialize scheduled tasks
    try {
      const {
        startBirthdayBonusScheduler,
      } = require("./server/services/birthdayBonusScheduler");
      startBirthdayBonusScheduler();
      console.log("✅ Birthday bonus scheduler initialized");
    } catch (schedulerError) {
      console.error(
        "⚠️  Failed to initialize birthday bonus scheduler:",
        schedulerError.message
      );
      // Don't fail server startup if scheduler fails
    }

    try {
      const {
        startScheduledInvoiceGenerator,
      } = require("./server/services/scheduledInvoiceGenerator");
      startScheduledInvoiceGenerator();
      console.log("✅ Scheduled invoice generator initialized");
    } catch (schedulerError) {
      console.error(
        "⚠️  Failed to initialize scheduled invoice generator:",
        schedulerError.message
      );
      // Don't fail server startup if scheduler fails
    }

    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`🔗 API base URL: http://localhost:${port}/api`);
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`❌ Port ${port} is already in use`);
        process.exit(1);
      } else {
        console.error("❌ Server error:", error.message);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1);
  }
};

// Start server
const PORT = config.PORT;

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("\n❌ UNHANDLED PROMISE REJECTION:");
  console.error("Reason:", reason);
  if (config.NODE_ENV === "development") {
    console.error("Promise:", promise);
    if (reason instanceof Error) {
      console.error("Stack:", reason.stack);
    }
  }
  console.error("---\n");
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("\n❌ UNCAUGHT EXCEPTION:");
  console.error("Error:", error.message);
  if (config.NODE_ENV === "development") {
    console.error("Stack:", error.stack);
  }
  console.error("---\n");
  // Don't exit in development - let the error handler deal with it
  if (config.NODE_ENV === "production") {
    process.exit(1);
  }
});

startServer(PORT).catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
