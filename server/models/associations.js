// Model Associations
// This file handles all associations between models to avoid circular dependencies

const { Vendor } = require(".");

function setupAssociations(models) {
  const {
    User,
    Account,
    OpeningBalance,
    Store,
    FinancialYear,
    AccountType,
    UserStore,
    Currency,
    ExchangeRate,
    PaymentMethod,
    PaymentType,
    TaxCode,
    AdjustmentReason,
    ReturnReason,
    ProductCategory,
    ProductModel,
    Product,
    ProductStoreLocation,
    ProductColor,
    Packaging,
    ProductManufacturer,
    ProductBrandName,
    PriceCategory,
    ProductPriceCategory,
    ProductStore,
    ProductPharmaceuticalInfo,
    TransactionType,
    CostingMethod,
    PriceChangeReason,
    PriceHistory,
    StockAdjustment,
    StockAdjustmentItem,
    StoreRequest,
    StoreRequestItem,
    StoreRequestItemTransaction,
    SalesAgent,
    BankDetail,
    CustomerDeposit,
    Customer,
    CustomerGroup,
    ProformaInvoice,
    ProformaInvoiceItem,
    SalesOrder,
    SalesOrderItem,
    SalesInvoice,
    SalesInvoiceItem,
    SalesTransaction,
    LinkedAccount,
    LoyaltyCardConfig,
    LoyaltyCard,
    LoyaltyTransaction,
    Receipt,
    ReceiptItem,
    ReceiptTransaction,
    Company,
    ReturnOut,
    ReturnOutItem,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseInvoice,
  PurchaseInvoiceItem,
  PurchaseInvoicePayment,
    JournalEntry,
    JournalEntryLine,
  } = models;

  // Account self-referencing associations (parent-child relationships)
  Account.hasMany(Account, { as: "children", foreignKey: "parentId" });
  Account.belongsTo(Account, { as: "parent", foreignKey: "parentId" });

  // Account associations
  Account.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
  Account.belongsTo(User, { as: "updater", foreignKey: "updatedBy" });
  Account.belongsTo(AccountType, {
    as: "accountType",
    foreignKey: "accountTypeId",
  });
  Account.hasMany(OpeningBalance, {
    as: "openingBalances",
    foreignKey: "accountId",
  });

  // AccountType associations
  AccountType.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  AccountType.belongsTo(User, { as: "updater", foreignKey: "updated_by" });
  AccountType.hasMany(Account, { as: "accounts", foreignKey: "accountTypeId" });
  AccountType.hasMany(OpeningBalance, {
    as: "openingBalances",
    foreignKey: "accountTypeId",
  });
  User.hasMany(AccountType, {
    as: "createdAccountTypes",
    foreignKey: "created_by",
  });
  User.hasMany(AccountType, {
    as: "updatedAccountTypes",
    foreignKey: "updated_by",
  });

  // OpeningBalance associations
  OpeningBalance.belongsTo(Account, { as: "account", foreignKey: "accountId" });
  OpeningBalance.belongsTo(AccountType, {
    as: "accountType",
    foreignKey: "accountTypeId",
  });
  OpeningBalance.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
  OpeningBalance.belongsTo(User, { as: "updater", foreignKey: "updatedBy" });
  OpeningBalance.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currencyId",
  });
  OpeningBalance.belongsTo(ExchangeRate, {
    as: "exchangeRateRecord",
    foreignKey: "exchangeRateId",
  });
  OpeningBalance.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financialYearId",
  });
  OpeningBalance.belongsTo(TransactionType, {
    as: "transactionType",
    foreignKey: "transaction_type_id",
  });

  // JournalEntry associations
  JournalEntry.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financialYearId",
  });
  JournalEntry.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
  JournalEntry.belongsTo(User, { as: "updater", foreignKey: "updatedBy" });
  JournalEntry.belongsTo(User, { as: "poster", foreignKey: "postedBy" });
  JournalEntry.hasMany(JournalEntryLine, {
    as: "lines",
    foreignKey: "journalEntryId",
  });
  User.hasMany(JournalEntry, {
    as: "createdJournalEntries",
    foreignKey: "createdBy",
  });
  User.hasMany(JournalEntry, {
    as: "updatedJournalEntries",
    foreignKey: "updatedBy",
  });
  User.hasMany(JournalEntry, {
    as: "postedJournalEntries",
    foreignKey: "postedBy",
  });
  FinancialYear.hasMany(JournalEntry, {
    as: "journalEntries",
    foreignKey: "financialYearId",
  });

  // JournalEntryLine associations
  JournalEntryLine.belongsTo(JournalEntry, {
    as: "journalEntry",
    foreignKey: "journalEntryId",
  });
  JournalEntryLine.belongsTo(Account, {
    as: "account",
    foreignKey: "accountId",
  });
  JournalEntryLine.belongsTo(AccountType, {
    as: "accountType",
    foreignKey: "accountTypeId",
  });
  JournalEntryLine.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currencyId",
  });
  JournalEntryLine.belongsTo(ExchangeRate, {
    as: "exchangeRateRecord",
    foreignKey: "exchangeRateId",
  });
  Account.hasMany(JournalEntryLine, {
    as: "journalEntryLines",
    foreignKey: "accountId",
  });
  AccountType.hasMany(JournalEntryLine, {
    as: "journalEntryLines",
    foreignKey: "accountTypeId",
  });

  // User-Company associations
  User.belongsTo(Company, { as: "company", foreignKey: "companyId" });
  Company.hasMany(User, { as: "users", foreignKey: "companyId" });

  // User associations
  User.hasMany(Account, { as: "createdAccounts", foreignKey: "createdBy" });
  User.hasMany(Account, { as: "updatedAccounts", foreignKey: "updatedBy" });
  User.hasMany(OpeningBalance, {
    as: "createdOpeningBalances",
    foreignKey: "createdBy",
  });

  // Store associations
  Store.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  Store.belongsTo(User, { as: "updater", foreignKey: "updated_by" });
  Store.belongsTo(Currency, {
    as: "defaultCurrency",
    foreignKey: "default_currency_id",
  });
  Store.belongsTo(PriceCategory, {
    as: "defaultPriceCategory",
    foreignKey: "default_price_category_id",
  });
  User.hasMany(Store, { as: "createdStores", foreignKey: "created_by" });
  User.hasMany(Store, { as: "updatedStores", foreignKey: "updated_by" });
  Currency.hasMany(Store, { as: "stores", foreignKey: "default_currency_id" });
  PriceCategory.hasMany(Store, {
    as: "stores",
    foreignKey: "default_price_category_id",
  });
  PriceCategory.hasMany(ProformaInvoice, {
    as: "proformaInvoices",
    foreignKey: "price_category_id",
  });

  // User-Store many-to-many associations
  User.belongsToMany(Store, {
    through: UserStore,
    as: "assignedStores",
    foreignKey: "user_id",
    otherKey: "store_id",
  });

  Store.belongsToMany(User, {
    through: UserStore,
    as: "assignedUsers",
    foreignKey: "store_id",
    otherKey: "user_id",
  });

  // UserStore associations
  UserStore.belongsTo(User, { as: "user", foreignKey: "user_id" });
  UserStore.belongsTo(Store, { as: "userStore", foreignKey: "store_id" });
  UserStore.belongsTo(User, { as: "assignedBy", foreignKey: "assigned_by" });

  // FinancialYear associations
  FinancialYear.hasMany(OpeningBalance, {
    as: "openingBalances",
    foreignKey: "financialYearId",
  });
  FinancialYear.hasMany(CustomerDeposit, {
    as: "customerDeposits",
    foreignKey: "financialYearId",
  });
  FinancialYear.hasMany(SalesOrder, {
    as: "salesOrders",
    foreignKey: "financial_year_id",
  });
  FinancialYear.hasMany(SalesOrderItem, {
    as: "salesOrderItems",
    foreignKey: "financial_year_id",
  });
  FinancialYear.hasMany(SalesInvoice, {
    as: "salesInvoices",
    foreignKey: "financial_year_id",
  });
  FinancialYear.hasMany(SalesInvoiceItem, {
    as: "salesInvoiceItems",
    foreignKey: "financial_year_id",
  });
  FinancialYear.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
  FinancialYear.belongsTo(User, { as: "updater", foreignKey: "updatedBy" });
  FinancialYear.belongsTo(User, { as: "closer", foreignKey: "closedBy" });
  User.hasMany(FinancialYear, {
    as: "createdFinancialYears",
    foreignKey: "createdBy",
  });
  User.hasMany(FinancialYear, {
    as: "updatedFinancialYears",
    foreignKey: "updatedBy",
  });
  User.hasMany(FinancialYear, {
    as: "closedFinancialYears",
    foreignKey: "closedBy",
  });

  // Currency associations
  Currency.hasMany(OpeningBalance, {
    as: "openingBalances",
    foreignKey: "currencyId",
  });
  Currency.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  Currency.belongsTo(User, { as: "updater", foreignKey: "updated_by" });
  User.hasMany(Currency, { as: "createdCurrencies", foreignKey: "created_by" });
  User.hasMany(Currency, { as: "updatedCurrencies", foreignKey: "updated_by" });

  // ExchangeRate associations
  ExchangeRate.hasMany(OpeningBalance, {
    as: "openingBalances",
    foreignKey: "exchangeRateId",
  });
  ExchangeRate.belongsTo(Currency, {
    as: "fromCurrency",
    foreignKey: "from_currency_id",
  });
  ExchangeRate.belongsTo(Currency, {
    as: "toCurrency",
    foreignKey: "to_currency_id",
  });
  ExchangeRate.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  ExchangeRate.belongsTo(User, { as: "updater", foreignKey: "updated_by" });

  // Currency-ExchangeRate associations
  Currency.hasMany(ExchangeRate, {
    as: "fromExchangeRates",
    foreignKey: "from_currency_id",
  });
  Currency.hasMany(ExchangeRate, {
    as: "toExchangeRates",
    foreignKey: "to_currency_id",
  });

  // User-ExchangeRate associations
  User.hasMany(ExchangeRate, {
    as: "createdExchangeRates",
    foreignKey: "created_by",
  });
  User.hasMany(ExchangeRate, {
    as: "updatedExchangeRates",
    foreignKey: "updated_by",
  });

  // PaymentMethod associations
  PaymentMethod.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
  PaymentMethod.belongsTo(User, { as: "updater", foreignKey: "updatedBy" });
  PaymentMethod.hasMany(PaymentType, {
    as: "paymentTypes",
    foreignKey: "payment_method_id",
  });
  User.hasMany(PaymentMethod, {
    as: "createdPaymentMethods",
    foreignKey: "createdBy",
  });
  User.hasMany(PaymentMethod, {
    as: "updatedPaymentMethods",
    foreignKey: "updatedBy",
  });

  // BankDetail associations
  BankDetail.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
  BankDetail.belongsTo(User, { as: "updater", foreignKey: "updatedBy" });
  BankDetail.belongsTo(Account, { as: "account", foreignKey: "accountId" });
  User.hasMany(BankDetail, {
    as: "createdBankDetails",
    foreignKey: "createdBy",
  });
  User.hasMany(BankDetail, {
    as: "updatedBankDetails",
    foreignKey: "updatedBy",
  });
  Account.hasMany(BankDetail, { as: "bankDetails", foreignKey: "accountId" });

  // PaymentType associations
  PaymentType.belongsTo(PaymentMethod, {
    as: "paymentMethod",
    foreignKey: "payment_method_id",
  });
  PaymentType.belongsTo(Account, {
    as: "defaultAccount",
    foreignKey: "default_account_id",
  });
  PaymentType.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  PaymentType.belongsTo(User, { as: "updater", foreignKey: "updated_by" });

  // User-PaymentType associations
  User.hasMany(PaymentType, {
    as: "createdPaymentTypes",
    foreignKey: "created_by",
  });
  User.hasMany(PaymentType, {
    as: "updatedPaymentTypes",
    foreignKey: "updated_by",
  });

  // Account-PaymentType associations
  Account.hasMany(PaymentType, {
    as: "defaultPaymentTypes",
    foreignKey: "default_account_id",
  });

  // TaxCode associations
  TaxCode.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  TaxCode.belongsTo(User, { as: "updater", foreignKey: "updated_by" });
  TaxCode.belongsTo(Account, {
    as: "salesTaxAccount",
    foreignKey: "sales_tax_account_id",
  });
  TaxCode.belongsTo(Account, {
    as: "purchasesTaxAccount",
    foreignKey: "purchases_tax_account_id",
  });

  // User-TaxCode associations
  User.hasMany(TaxCode, { as: "createdTaxCodes", foreignKey: "created_by" });
  User.hasMany(TaxCode, { as: "updatedTaxCodes", foreignKey: "updated_by" });

  // Account-TaxCode associations
  Account.hasMany(TaxCode, {
    as: "salesTaxCodes",
    foreignKey: "sales_tax_account_id",
  });
  Account.hasMany(TaxCode, {
    as: "purchasesTaxCodes",
    foreignKey: "purchases_tax_account_id",
  });

  // AdjustmentReason associations are defined in the model file itself

  // ProductCategory associations
  ProductCategory.belongsTo(TaxCode, {
    as: "taxCode",
    foreignKey: "tax_code_id",
  });
  ProductCategory.belongsTo(TaxCode, {
    as: "purchasesTax",
    foreignKey: "purchases_tax_id",
  });
  ProductCategory.belongsTo(Account, {
    as: "cogsAccount",
    foreignKey: "cogs_account_id",
  });
  ProductCategory.belongsTo(Account, {
    as: "incomeAccount",
    foreignKey: "income_account_id",
  });
  ProductCategory.belongsTo(Account, {
    as: "assetAccount",
    foreignKey: "asset_account_id",
  });
  ProductCategory.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProductCategory.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // User-ProductCategory associations
  User.hasMany(ProductCategory, {
    as: "createdProductCategories",
    foreignKey: "created_by",
  });
  User.hasMany(ProductCategory, {
    as: "updatedProductCategories",
    foreignKey: "updated_by",
  });

  // TaxCode-ProductCategory associations
  TaxCode.hasMany(ProductCategory, {
    as: "productCategories",
    foreignKey: "tax_code_id",
  });
  TaxCode.hasMany(ProductCategory, {
    as: "purchasesProductCategories",
    foreignKey: "purchases_tax_id",
  });

  // Account-ProductCategory associations
  Account.hasMany(ProductCategory, {
    as: "cogsProductCategories",
    foreignKey: "cogs_account_id",
  });
  Account.hasMany(ProductCategory, {
    as: "incomeProductCategories",
    foreignKey: "income_account_id",
  });
  Account.hasMany(ProductCategory, {
    as: "assetProductCategories",
    foreignKey: "asset_account_id",
  });

  // ProductModel associations
  ProductModel.belongsTo(ProductCategory, {
    as: "category",
    foreignKey: "category_id",
  });
  ProductModel.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProductModel.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // User-ProductModel associations
  User.hasMany(ProductModel, {
    as: "createdProductModels",
    foreignKey: "created_by",
  });
  User.hasMany(ProductModel, {
    as: "updatedProductModels",
    foreignKey: "updated_by",
  });

  // ProductCategory-ProductModel associations
  ProductCategory.hasMany(ProductModel, {
    as: "productModels",
    foreignKey: "category_id",
  });

  // Product associations
  models.Product.belongsTo(models.ProductCategory, {
    as: "category",
    foreignKey: "category_id",
  });
  models.Product.belongsTo(models.ProductModel, {
    as: "model",
    foreignKey: "model_id",
  });
  models.Product.belongsTo(models.ProductBrandName, {
    as: "brand",
    foreignKey: "brand_id",
  });
  models.Product.belongsTo(models.ProductManufacturer, {
    as: "manufacturer",
    foreignKey: "manufacturer_id",
  });
  models.Product.belongsTo(models.ProductStoreLocation, {
    as: "storeLocation",
    foreignKey: "store_location_id",
  });
  models.Product.belongsTo(models.ProductColor, {
    as: "color",
    foreignKey: "color_id",
  });
  models.Product.belongsTo(models.Packaging, {
    as: "unit",
    foreignKey: "unit_id",
  });
  models.Product.belongsTo(models.Account, {
    as: "cogsAccount",
    foreignKey: "cogs_account_id",
  });
  models.Product.belongsTo(models.Account, {
    as: "incomeAccount",
    foreignKey: "income_account_id",
  });
  models.Product.belongsTo(models.Account, {
    as: "assetAccount",
    foreignKey: "asset_account_id",
  });
  models.Product.belongsTo(models.TaxCode, {
    as: "purchasesTax",
    foreignKey: "purchases_tax_id",
  });
  models.Product.belongsTo(models.TaxCode, {
    as: "salesTax",
    foreignKey: "sales_tax_id",
  });
  models.Product.belongsTo(models.Packaging, {
    as: "defaultPackaging",
    foreignKey: "default_packaging_id",
  });
  models.Product.belongsTo(models.User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  models.Product.belongsTo(models.User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // Product has many ProductPriceCategories
  models.Product.hasMany(models.ProductPriceCategory, {
    as: "ProductPriceCategories",
    foreignKey: "product_id",
  });

  // User-Product associations
  models.User.hasMany(models.Product, {
    as: "createdProducts",
    foreignKey: "created_by",
  });
  models.User.hasMany(models.Product, {
    as: "updatedProducts",
    foreignKey: "updated_by",
  });

  // ProductCategory-Product associations
  models.ProductCategory.hasMany(models.Product, {
    as: "products",
    foreignKey: "category_id",
  });

  // ProductModel-Product associations
  models.ProductModel.hasMany(models.Product, {
    as: "products",
    foreignKey: "model_id",
  });

  // ProductBrandName-Product associations
  models.ProductBrandName.hasMany(models.Product, {
    as: "products",
    foreignKey: "brand_id",
  });

  // ProductManufacturer-Product associations
  models.ProductManufacturer.hasMany(models.Product, {
    as: "products",
    foreignKey: "manufacturer_id",
  });

  // ProductStoreLocation-Product associations
  models.ProductStoreLocation.hasMany(models.Product, {
    as: "products",
    foreignKey: "store_location_id",
  });

  // Packaging-Product associations
  models.Packaging.hasMany(models.Product, {
    as: "unitProducts",
    foreignKey: "unit_id",
  });
  models.Packaging.hasMany(models.Product, {
    as: "defaultPackagingProducts",
    foreignKey: "default_packaging_id",
  });

  // Account-Product associations
  models.Account.hasMany(models.Product, {
    as: "cogsProducts",
    foreignKey: "cogs_account_id",
  });
  models.Account.hasMany(models.Product, {
    as: "incomeProducts",
    foreignKey: "income_account_id",
  });
  models.Account.hasMany(models.Product, {
    as: "assetProducts",
    foreignKey: "asset_account_id",
  });

  // TaxCode-Product associations
  models.TaxCode.hasMany(models.Product, {
    as: "purchasesTaxProducts",
    foreignKey: "purchases_tax_id",
  });
  models.TaxCode.hasMany(models.Product, {
    as: "salesTaxProducts",
    foreignKey: "sales_tax_id",
  });

  // ProductColor associations
  ProductColor.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProductColor.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // User-ProductColor associations
  User.hasMany(ProductColor, {
    as: "createdProductColors",
    foreignKey: "created_by",
  });
  User.hasMany(ProductColor, {
    as: "updatedProductColors",
    foreignKey: "updated_by",
  });

  // Packaging associations
  Packaging.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
  Packaging.belongsTo(User, { as: "updater", foreignKey: "updatedBy" });

  // User-Packaging associations
  User.hasMany(Packaging, { as: "createdPackaging", foreignKey: "createdBy" });
  User.hasMany(Packaging, { as: "updatedPackaging", foreignKey: "updatedBy" });

  // ProductManufacturer associations
  ProductManufacturer.belongsTo(ProductCategory, {
    as: "category",
    foreignKey: "category_id",
  });
  ProductManufacturer.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProductManufacturer.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });
  User.hasMany(ProductManufacturer, {
    as: "createdProductManufacturers",
    foreignKey: "created_by",
  });
  User.hasMany(ProductManufacturer, {
    as: "updatedProductManufacturers",
    foreignKey: "updated_by",
  });
  ProductCategory.hasMany(ProductManufacturer, {
    as: "productManufacturers",
    foreignKey: "category_id",
  });

  // ProductBrandName associations
  ProductBrandName.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProductBrandName.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });
  User.hasMany(ProductBrandName, {
    as: "createdProductBrandNames",
    foreignKey: "created_by",
  });
  User.hasMany(ProductBrandName, {
    as: "updatedProductBrandNames",
    foreignKey: "updated_by",
  });

  // PriceCategory associations
  PriceCategory.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  PriceCategory.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  User.hasMany(PriceCategory, {
    as: "createdPriceCategories",
    foreignKey: "created_by",
  });
  User.hasMany(PriceCategory, {
    as: "updatedPriceCategories",
    foreignKey: "updated_by",
  });

  // ProductStoreLocation associations
  ProductStoreLocation.belongsTo(Store, {
    as: "storeLocation",
    foreignKey: "store_id",
  });
  ProductStoreLocation.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProductStoreLocation.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // User-ProductStoreLocation associations
  User.hasMany(ProductStoreLocation, {
    as: "createdProductStoreLocations",
    foreignKey: "created_by",
  });
  User.hasMany(ProductStoreLocation, {
    as: "updatedProductStoreLocations",
    foreignKey: "updated_by",
  });

  // Store-ProductStoreLocation associations
  Store.hasMany(ProductStoreLocation, {
    as: "storeLocations",
    foreignKey: "store_id",
  });

  // ProductPriceCategory associations (many-to-many with calculated prices)
  Product.belongsToMany(PriceCategory, {
    through: ProductPriceCategory,
    as: "priceCategories",
    foreignKey: "product_id",
    otherKey: "price_category_id",
  });

  PriceCategory.belongsToMany(Product, {
    through: ProductPriceCategory,
    as: "products",
    foreignKey: "price_category_id",
    otherKey: "product_id",
  });

  // ProductPriceCategory direct associations
  ProductPriceCategory.belongsTo(Product, {
    as: "product",
    foreignKey: "product_id",
  });
  ProductPriceCategory.belongsTo(PriceCategory, {
    as: "priceCategory",
    foreignKey: "price_category_id",
  });
  ProductPriceCategory.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProductPriceCategory.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // User-ProductPriceCategory associations
  User.hasMany(ProductPriceCategory, {
    as: "createdProductPriceCategories",
    foreignKey: "created_by",
  });
  User.hasMany(ProductPriceCategory, {
    as: "updatedProductPriceCategories",
    foreignKey: "updated_by",
  });

  // Product-Store many-to-many associations
  Product.belongsToMany(Store, {
    through: ProductStore,
    as: "assignedStores",
    foreignKey: "product_id",
    otherKey: "store_id",
  });

  Store.belongsToMany(Product, {
    through: ProductStore,
    as: "assignedProducts",
    foreignKey: "store_id",
    otherKey: "product_id",
  });

  // ProductStore associations
  ProductStore.belongsTo(Product, {
    as: "productStore",
    foreignKey: "product_id",
  });
  ProductStore.belongsTo(Store, {
    as: "productStoreStore",
    foreignKey: "store_id",
  });
  ProductStore.belongsTo(User, {
    as: "productStoreAssignedBy",
    foreignKey: "assigned_by",
  });

  // User-ProductStore associations
  User.hasMany(ProductStore, {
    as: "assignedProductStores",
    foreignKey: "assigned_by",
  });

  // ProductPharmaceuticalInfo associations
  models.ProductPharmaceuticalInfo.belongsTo(models.Product, {
    as: "pharmaceuticalProduct",
    foreignKey: "product_id",
  });
  models.ProductPharmaceuticalInfo.belongsTo(models.User, {
    as: "pharmaceuticalCreator",
    foreignKey: "created_by",
  });
  models.ProductPharmaceuticalInfo.belongsTo(models.User, {
    as: "pharmaceuticalUpdater",
    foreignKey: "updated_by",
  });

  // Product-ProductPharmaceuticalInfo associations
  models.Product.hasOne(models.ProductPharmaceuticalInfo, {
    as: "pharmaceuticalInfo",
    foreignKey: "product_id",
  });

  // User-ProductPharmaceuticalInfo associations
  models.User.hasMany(models.ProductPharmaceuticalInfo, {
    as: "createdPharmaceuticalInfo",
    foreignKey: "created_by",
  });
  models.User.hasMany(models.ProductPharmaceuticalInfo, {
    as: "updatedPharmaceuticalInfo",
    foreignKey: "updated_by",
  });

  // ProductManufacturingInfo associations
  models.ProductManufacturingInfo.belongsTo(models.Product, {
    as: "manufacturingProduct",
    foreignKey: "product_id",
  });
  models.ProductManufacturingInfo.belongsTo(models.User, {
    as: "manufacturingCreator",
    foreignKey: "created_by",
  });
  models.ProductManufacturingInfo.belongsTo(models.User, {
    as: "manufacturingUpdater",
    foreignKey: "updated_by",
  });

  // Product-ProductManufacturingInfo associations
  models.Product.hasOne(models.ProductManufacturingInfo, {
    as: "manufacturingInfo",
    foreignKey: "product_id",
  });

  // User-ProductManufacturingInfo associations
  models.User.hasMany(models.ProductManufacturingInfo, {
    as: "createdManufacturingInfo",
    foreignKey: "created_by",
  });
  models.User.hasMany(models.ProductManufacturingInfo, {
    as: "updatedManufacturingInfo",
    foreignKey: "updated_by",
  });

  // ProductRawMaterial associations
  models.ProductRawMaterial.belongsTo(models.Product, {
    as: "rawMaterialProduct",
    foreignKey: "manufactured_product_id",
  });
  models.ProductRawMaterial.belongsTo(models.Product, {
    as: "rawMaterialItem",
    foreignKey: "raw_material_id",
  });
  models.ProductRawMaterial.belongsTo(models.User, {
    as: "rawMaterialCreator",
    foreignKey: "created_by",
  });
  models.ProductRawMaterial.belongsTo(models.User, {
    as: "rawMaterialUpdater",
    foreignKey: "updated_by",
  });

  // Product-ProductRawMaterial associations
  models.Product.hasMany(models.ProductRawMaterial, {
    as: "rawMaterials",
    foreignKey: "manufactured_product_id",
  });
  models.Product.hasMany(models.ProductRawMaterial, {
    as: "usedInProducts",
    foreignKey: "raw_material_id",
  });

  // User-ProductRawMaterial associations
  User.hasMany(models.ProductRawMaterial, {
    as: "createdRawMaterials",
    foreignKey: "created_by",
  });
  User.hasMany(models.ProductRawMaterial, {
    as: "updatedRawMaterials",
    foreignKey: "updated_by",
  });

  // TransactionType associations
  TransactionType.hasMany(OpeningBalance, {
    as: "openingBalances",
    foreignKey: "transaction_type_id",
  });

  // Price History System Associations

  // CostingMethod associations
  CostingMethod.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  CostingMethod.belongsTo(User, { as: "updater", foreignKey: "updated_by" });

  // User-CostingMethod associations
  User.hasMany(CostingMethod, {
    as: "createdCostingMethods",
    foreignKey: "created_by",
  });
  User.hasMany(CostingMethod, {
    as: "updatedCostingMethods",
    foreignKey: "updated_by",
  });

  // PriceChangeReason associations
  PriceChangeReason.belongsTo(User, {
    as: "creator",
    foreignKey: "created_by",
  });
  PriceChangeReason.belongsTo(User, {
    as: "updater",
    foreignKey: "updated_by",
  });

  // User-PriceChangeReason associations
  User.hasMany(PriceChangeReason, {
    as: "createdPriceChangeReasons",
    foreignKey: "created_by",
  });
  User.hasMany(PriceChangeReason, {
    as: "updatedPriceChangeReasons",
    foreignKey: "updated_by",
  });

  // PriceHistory associations
  PriceHistory.belongsTo(CostingMethod, {
    as: "costingMethod",
    foreignKey: "costing_method_id",
  });
  PriceHistory.belongsTo(PriceChangeReason, {
    as: "priceChangeReason",
    foreignKey: "price_change_reason_id",
  });
  PriceHistory.belongsTo(TransactionType, {
    as: "transactionType",
    foreignKey: "transaction_type_id",
  });
  PriceHistory.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  PriceHistory.belongsTo(User, { as: "creator", foreignKey: "created_by" });

  // User-PriceHistory associations
  User.hasMany(PriceHistory, {
    as: "createdPriceHistory",
    foreignKey: "created_by",
  });

  // CostingMethod-PriceHistory associations
  CostingMethod.hasMany(PriceHistory, {
    as: "priceHistory",
    foreignKey: "costing_method_id",
  });

  // PriceChangeReason-PriceHistory associations
  PriceChangeReason.hasMany(PriceHistory, {
    as: "priceHistory",
    foreignKey: "price_change_reason_id",
  });

  // TransactionType-PriceHistory associations
  TransactionType.hasMany(PriceHistory, {
    as: "priceHistory",
    foreignKey: "transaction_type_id",
  });

  // Currency-PriceHistory associations
  Currency.hasMany(PriceHistory, {
    as: "priceHistory",
    foreignKey: "currency_id",
  });

  // Stock Adjustment associations
  StockAdjustment.belongsTo(Store, { as: "store", foreignKey: "store_id" });
  StockAdjustment.belongsTo(AdjustmentReason, {
    as: "adjustmentReason",
    foreignKey: "reason_id",
  });
  StockAdjustment.belongsTo(Account, {
    as: "inventoryAccount",
    foreignKey: "account_id",
  });
  StockAdjustment.belongsTo(Account, {
    as: "correspondingAccount",
    foreignKey: "corresponding_account_id",
  });
  StockAdjustment.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  StockAdjustment.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  StockAdjustment.belongsTo(User, { as: "updater", foreignKey: "updated_by" });
  StockAdjustment.belongsTo(User, {
    as: "submitter",
    foreignKey: "submitted_by",
  });
  StockAdjustment.belongsTo(User, {
    as: "approver",
    foreignKey: "approved_by",
  });
  StockAdjustment.hasMany(StockAdjustmentItem, {
    as: "items",
    foreignKey: "stock_adjustment_id",
    onDelete: "CASCADE",
  });

  // Stock Adjustment Item associations
  StockAdjustmentItem.belongsTo(StockAdjustment, {
    as: "stockAdjustment",
    foreignKey: "stock_adjustment_id",
  });
  StockAdjustmentItem.belongsTo(Product, {
    as: "product",
    foreignKey: "product_id",
  });

  // Returns Out associations
  if (typeof models !== 'undefined') {
    // models may not be available in this scope; associations setup will wire these when available
  }

  // We'll reference models via the parameters used by setupAssociations (they are in scope)
  if (ReturnOut && ReturnOutItem) {
    ReturnOut.hasMany(ReturnOutItem, { as: 'items', foreignKey: 'return_out_id' });
    ReturnOut.belongsTo(Store, { as: 'store', foreignKey: 'store_id' });
    ReturnOut.belongsTo(models.Vendor, { as: 'vendor', foreignKey: 'vendor_id' });
    // Return reason model in this codebase is `ReturnReason` (file created earlier)
    try {
      const ReturnReasonModel = typeof ReturnReason !== 'undefined' ? ReturnReason : null;
      ReturnOut.belongsTo(ReturnReasonModel || ReturnReason, { as: 'returnReason', foreignKey: 'return_reason_id' });
    } catch (e) {
      ReturnOut.belongsTo(ReturnReason, { as: 'returnReason', foreignKey: 'return_reason_id' });
    }
    ReturnOut.belongsTo(Currency, { as: 'currency', foreignKey: 'currency_id' });

    ReturnOutItem.belongsTo(ReturnOut, { as: 'returnOut', foreignKey: 'return_out_id' });
    ReturnOutItem.belongsTo(Product, { as: 'product', foreignKey: 'product_id' });
  }

  // Purchase Order associations
  if (typeof PurchaseOrder !== 'undefined' && typeof PurchaseOrderItem !== 'undefined') {
    PurchaseOrder.hasMany(PurchaseOrderItem, { as: 'items', foreignKey: 'purchase_order_id' });
    PurchaseOrder.belongsTo(models.Vendor, { as: 'vendor', foreignKey: 'vendor_id' });
    PurchaseOrder.belongsTo(Store, { as: 'store', foreignKey: 'store_id' });
    PurchaseOrder.belongsTo(Currency, { as: 'currency', foreignKey: 'currency_id' });

    PurchaseOrderItem.belongsTo(PurchaseOrder, { as: 'purchaseOrder', foreignKey: 'purchase_order_id' });
    PurchaseOrderItem.belongsTo(Product, { as: 'product', foreignKey: 'product_id' });
  }

  // Purchase Invoice associations
  if (typeof PurchaseInvoice !== 'undefined' && typeof PurchaseInvoiceItem !== 'undefined') {
    PurchaseInvoice.hasMany(PurchaseInvoiceItem, { as: 'items', foreignKey: 'purchase_invoice_id' });
    PurchaseInvoice.belongsTo(models.Vendor, { as: 'vendor', foreignKey: 'vendor_id' });
    PurchaseInvoice.belongsTo(Store, { as: 'store', foreignKey: 'store_id' });
    PurchaseInvoice.belongsTo(models.PurchaseOrder, { as: 'purchaseOrder', foreignKey: 'purchase_order_id' });
    PurchaseInvoice.belongsTo(Currency, { as: 'currency', foreignKey: 'currency_id' });

    PurchaseInvoiceItem.belongsTo(PurchaseInvoice, { as: 'purchaseInvoice', foreignKey: 'purchase_invoice_id' });
    PurchaseInvoiceItem.belongsTo(Product, { as: 'product', foreignKey: 'product_id' });

    if (typeof PurchaseInvoicePayment !== 'undefined') {
      PurchaseInvoice.hasMany(PurchaseInvoicePayment, { as: 'payments', foreignKey: 'purchase_invoice_id' });
      PurchaseInvoicePayment.belongsTo(PurchaseInvoice, { as: 'purchaseInvoice', foreignKey: 'purchase_invoice_id' });
      PurchaseInvoicePayment.belongsTo(User, { as: 'createdByUser', foreignKey: 'created_by' });
    }
  }

  // Reverse associations
  Store.hasMany(StockAdjustment, {
    as: "stockAdjustments",
    foreignKey: "store_id",
  });
  AdjustmentReason.hasMany(StockAdjustment, {
    as: "stockAdjustments",
    foreignKey: "reason_id",
  });
  Account.hasMany(StockAdjustment, {
    as: "inventoryStockAdjustments",
    foreignKey: "account_id",
  });
  Account.hasMany(StockAdjustment, {
    as: "correspondingStockAdjustments",
    foreignKey: "corresponding_account_id",
  });
  Currency.hasMany(StockAdjustment, {
    as: "stockAdjustments",
    foreignKey: "currency_id",
  });
  User.hasMany(StockAdjustment, {
    as: "createdStockAdjustments",
    foreignKey: "created_by",
  });
  User.hasMany(StockAdjustment, {
    as: "updatedStockAdjustments",
    foreignKey: "updated_by",
  });
  User.hasMany(StockAdjustment, {
    as: "approvedStockAdjustments",
    foreignKey: "approved_by",
  });
  Product.hasMany(StockAdjustmentItem, {
    as: "stockAdjustmentItems",
    foreignKey: "product_id",
  });

  // Store Request associations
  StoreRequest.belongsTo(Store, {
    as: "requestingStore",
    foreignKey: "requested_by_store_id",
  });
  StoreRequest.belongsTo(Store, {
    as: "issuingStore",
    foreignKey: "requested_from_store_id",
  });
  StoreRequest.belongsTo(Currency, {
    as: "storeRequestCurrency",
    foreignKey: "currency_id",
  });
  StoreRequest.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  StoreRequest.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });
  StoreRequest.belongsTo(User, {
    as: "submittedByUser",
    foreignKey: "submitted_by",
  });
  StoreRequest.belongsTo(User, {
    as: "approvedByUser",
    foreignKey: "approved_by",
  });
  StoreRequest.belongsTo(User, {
    as: "rejectedByUser",
    foreignKey: "rejected_by",
  });
  StoreRequest.belongsTo(User, {
    as: "fulfilledByUser",
    foreignKey: "fulfilled_by",
  });
  StoreRequest.hasMany(StoreRequestItem, {
    as: "storeRequestItems",
    foreignKey: "store_request_id",
    onDelete: "CASCADE",
  });

  // Store Request Item associations
  StoreRequestItem.belongsTo(StoreRequest, {
    as: "parentStoreRequest",
    foreignKey: "store_request_id",
  });
  StoreRequestItem.belongsTo(Product, {
    as: "storeRequestProduct",
    foreignKey: "product_id",
  });
  StoreRequestItem.belongsTo(Currency, {
    as: "storeRequestItemCurrency",
    foreignKey: "currency_id",
  });
  StoreRequestItem.belongsTo(User, { as: "creator", foreignKey: "created_by" });
  StoreRequestItem.belongsTo(User, { as: "updater", foreignKey: "updated_by" });
  StoreRequestItem.belongsTo(User, {
    as: "fulfiller",
    foreignKey: "fulfilled_by",
  });

  // Reverse Store Request associations
  Store.hasMany(StoreRequest, {
    as: "outgoingRequests",
    foreignKey: "requested_by_store_id",
  });
  Store.hasMany(StoreRequest, {
    as: "incomingRequests",
    foreignKey: "requested_from_store_id",
  });
  Currency.hasMany(StoreRequest, {
    as: "storeRequests",
    foreignKey: "currency_id",
  });
  User.hasMany(StoreRequest, {
    as: "createdStoreRequests",
    foreignKey: "created_by",
  });
  User.hasMany(StoreRequest, {
    as: "updatedStoreRequests",
    foreignKey: "updated_by",
  });
  User.hasMany(StoreRequest, {
    as: "submittedStoreRequests",
    foreignKey: "submitted_by",
  });
  User.hasMany(StoreRequest, {
    as: "approvedStoreRequests",
    foreignKey: "approved_by",
  });
  User.hasMany(StoreRequest, {
    as: "rejectedStoreRequests",
    foreignKey: "rejected_by",
  });
  User.hasMany(StoreRequest, {
    as: "fulfilledStoreRequests",
    foreignKey: "fulfilled_by",
  });
  Product.hasMany(StoreRequestItem, {
    as: "productStoreRequestItems",
    foreignKey: "product_id",
  });
  Currency.hasMany(StoreRequestItem, {
    as: "currencyStoreRequestItems",
    foreignKey: "currency_id",
  });
  User.hasMany(StoreRequestItem, {
    as: "createdStoreRequestItems",
    foreignKey: "created_by",
  });
  User.hasMany(StoreRequestItem, {
    as: "updatedStoreRequestItems",
    foreignKey: "updated_by",
  });
  User.hasMany(StoreRequestItem, {
    as: "fulfilledStoreRequestItems",
    foreignKey: "fulfilled_by",
  });

  // StoreRequestItemTransaction associations
  StoreRequestItem.hasMany(StoreRequestItemTransaction, {
    as: "itemTransactions",
    foreignKey: "store_request_item_id",
  });
  StoreRequestItemTransaction.belongsTo(StoreRequestItem, {
    as: "parentStoreRequestItem",
    foreignKey: "store_request_item_id",
  });
  StoreRequestItemTransaction.belongsTo(User, {
    as: "transactionPerformedByUser",
    foreignKey: "performed_by",
  });
  User.hasMany(StoreRequestItemTransaction, {
    as: "performedStoreRequestItemTransactions",
    foreignKey: "performed_by",
  });

  // SalesAgent associations
  SalesAgent.belongsTo(User, { as: "createdByUser", foreignKey: "created_by" });
  SalesAgent.belongsTo(User, { as: "updatedByUser", foreignKey: "updated_by" });
  SalesAgent.belongsTo(Company, { as: "company", foreignKey: "companyId" });
  SalesAgent.hasMany(SalesInvoice, {
    as: "salesInvoices",
    foreignKey: "sales_agent_id",
  });
  User.hasMany(SalesAgent, {
    as: "createdSalesAgents",
    foreignKey: "created_by",
  });
  User.hasMany(SalesAgent, {
    as: "updatedSalesAgents",
    foreignKey: "updated_by",
  });

  // CustomerDeposit associations
  CustomerDeposit.belongsTo(Customer, {
    as: "customer",
    foreignKey: "customerId",
  });
  CustomerDeposit.belongsTo(PaymentType, {
    as: "paymentType",
    foreignKey: "paymentTypeId",
  });
  CustomerDeposit.belongsTo(BankDetail, {
    as: "bankDetail",
    foreignKey: "bankDetailId",
  });
  CustomerDeposit.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currencyId",
  });
  CustomerDeposit.belongsTo(ExchangeRate, {
    as: "exchangeRateRecord",
    foreignKey: "exchangeRateId",
  });
  CustomerDeposit.belongsTo(Account, {
    as: "liabilityAccount",
    foreignKey: "liabilityAccountId",
  });
  CustomerDeposit.belongsTo(Account, {
    as: "assetAccount",
    foreignKey: "assetAccountId",
  });
  CustomerDeposit.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financialYearId",
  });
  CustomerDeposit.belongsTo(User, { as: "creator", foreignKey: "createdBy" });
  CustomerDeposit.belongsTo(User, { as: "updater", foreignKey: "updatedBy" });

  // Reverse associations
  Customer.hasMany(CustomerDeposit, {
    as: "deposits",
    foreignKey: "customerId",
  });
  PaymentType.hasMany(CustomerDeposit, {
    as: "customerDeposits",
    foreignKey: "paymentTypeId",
  });
  BankDetail.hasMany(CustomerDeposit, {
    as: "customerDeposits",
    foreignKey: "bankDetailId",
  });
  Currency.hasMany(CustomerDeposit, {
    as: "customerDeposits",
    foreignKey: "currencyId",
  });
  ExchangeRate.hasMany(CustomerDeposit, {
    as: "customerDeposits",
    foreignKey: "exchangeRateId",
  });
  Account.hasMany(CustomerDeposit, {
    as: "liabilityDeposits",
    foreignKey: "liabilityAccountId",
  });
  Account.hasMany(CustomerDeposit, {
    as: "assetDeposits",
    foreignKey: "assetAccountId",
  });
  User.hasMany(CustomerDeposit, {
    as: "createdCustomerDeposits",
    foreignKey: "createdBy",
  });
  User.hasMany(CustomerDeposit, {
    as: "updatedCustomerDeposits",
    foreignKey: "updatedBy",
  });

  // CustomerGroup associations (reverse relationships only)
  CustomerGroup.hasMany(Customer, {
    as: "customers",
    foreignKey: "customer_group_id",
  });

  // Vendor and VendorGroup associations
  // Vendor belongs to a VendorGroup and a Company, and may reference a default payable Account
  models.Vendor.belongsTo(models.VendorGroup, {
    as: "vendorGroup",
    foreignKey: "vendor_group_id",
  });
  models.Vendor.belongsTo(models.Company, {
    as: "company",
    foreignKey: "companyId",
  });

  models.Vendor.belongsTo(models.Account, {
    as: "defaultPayableAccount",
    foreignKey: "default_payable_account_id",
  });

  // Vendor <-> Product many-to-many via VendorProduct
  if (models.VendorProduct) {
    models.Vendor.belongsToMany(models.Product, {
      through: models.VendorProduct,
      as: "products",
      foreignKey: "vendor_id",
      otherKey: "product_id",
    });
    models.Product.belongsToMany(models.Vendor, {
      through: models.VendorProduct,
      as: "vendors",
      foreignKey: "product_id",
      otherKey: "vendor_id",
    });
    // Expose direct access to join entries
    models.Vendor.hasMany(models.VendorProduct, {
      as: "vendorProducts",
      foreignKey: "vendor_id",
    });
    models.Product.hasMany(models.VendorProduct, {
      as: "productVendors",
      foreignKey: "product_id",
    });
  }

  // Reverse associations for Vendor
  models.VendorGroup.hasMany(models.Vendor, {
    as: "vendors",
    foreignKey: "vendor_group_id",
  });
  models.Company.hasMany(models.Vendor, {
    as: "vendors",
    foreignKey: "companyId",
  });
  models.Account.hasMany(models.Vendor, {
    as: "defaultPayableVendors",
    foreignKey: "default_payable_account_id",
  });

  // VendorGroup belongs to Company and references liability/payable Accounts
  models.VendorGroup.belongsTo(models.Company, {
    as: "company",
    foreignKey: "companyId",
  });
  models.VendorGroup.belongsTo(models.Account, {
    as: "liabilityAccount",
    foreignKey: "liablity_account_id",
  });
  models.VendorGroup.belongsTo(models.Account, {
    as: "payableAccount",
    foreignKey: "payable_account_id",
  });

  // VendorGroup -> User associations for created_by / updated_by
  models.VendorGroup.belongsTo(models.User, {
    as: "creator",
    foreignKey: "created_by",
  });
  models.VendorGroup.belongsTo(models.User, {
    as: "updater",
    foreignKey: "updated_by",
  });
  models.Vendor.belongsTo(models.User, {
    as: "creator",
    foreignKey: "created_by",
  });
  models.Vendor.belongsTo(models.User, {
    as: "updater",
    foreignKey: "updated_by",
  });

  // Reverse associations for VendorGroup -> Account
  models.Account.hasMany(models.VendorGroup, {
    as: "liabilityVendorGroups",
    foreignKey: "liablity_account_id",
  });
  models.Account.hasMany(models.VendorGroup, {
    as: "payableVendorGroups",
    foreignKey: "payable_account_id",
  });
  models.Company.hasMany(models.VendorGroup, {
    as: "vendorGroups",
    foreignKey: "companyId",
  });

  // LoyaltyCardConfig associations (reverse relationships only)
  LoyaltyCardConfig.hasMany(Customer, {
    as: "customers",
    foreignKey: "loyalty_card_config_id",
  });

  // User-Customer associations (reverse relationships only)
  User.hasMany(Customer, { as: "createdCustomers", foreignKey: "created_by" });
  User.hasMany(Customer, { as: "updatedCustomers", foreignKey: "updated_by" });
  User.hasMany(models.Vendor, {
    as: "createdVendors",
    foreignKey: "created_by",
  });
  User.hasMany(models.Vendor, {
    as: "updatedVendors",
    foreignKey: "updated_by",
  });
  User.hasMany(models.VendorGroup, {
    as: "createdVendorGroups",
    foreignKey: "created_by",
  });
  User.hasMany(models.VendorGroup, {
    as: "updatedVendorGroups",
    foreignKey: "updated_by",
  });
  // ReturnReason associations
  ReturnReason.belongsTo(User, {
    as: "createdByUserReturnReason",
    foreignKey: "created_by",
  });
  ReturnReason.belongsTo(User, {
    as: "updatedByUserReturnReason",
    foreignKey: "updated_by",
  });
  ReturnReason.belongsTo(Account, {
    as: "refundAccount",
    foreignKey: "refund_account_id",
  });
  ReturnReason.belongsTo(Account, {
    as: "inventoryAccount",
    foreignKey: "inventory_account_id",
  });

  // Reverse associations
  User.hasMany(ReturnReason, {
    as: "createdReturnReasons",
    foreignKey: "created_by",
  });
  User.hasMany(ReturnReason, {
    as: "updatedReturnReasons",
    foreignKey: "updated_by",
  });
  Account.hasMany(ReturnReason, {
    as: "refundReturnReasons",
    foreignKey: "refund_account_id",
  });
  Account.hasMany(ReturnReason, {
    as: "inventoryReturnReasons",
    foreignKey: "inventory_account_id",
  });

  // ProformaInvoice associations
  ProformaInvoice.belongsTo(Store, { as: "store", foreignKey: "store_id" });
  ProformaInvoice.belongsTo(Customer, {
    as: "customer",
    foreignKey: "customer_id",
  });
  ProformaInvoice.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  ProformaInvoice.belongsTo(Currency, {
    as: "systemDefaultCurrency",
    foreignKey: "system_default_currency_id",
  });
  ProformaInvoice.belongsTo(ExchangeRate, {
    as: "exchangeRate",
    foreignKey: "exchange_rate_id",
  });
  ProformaInvoice.belongsTo(PriceCategory, {
    as: "priceCategory",
    foreignKey: "price_category_id",
  });
  ProformaInvoice.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProformaInvoice.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });
  ProformaInvoice.belongsTo(User, { as: "sentByUser", foreignKey: "sent_by" });
  ProformaInvoice.belongsTo(User, {
    as: "acceptedByUser",
    foreignKey: "accepted_by",
  });
  ProformaInvoice.belongsTo(User, {
    as: "rejectedByUser",
    foreignKey: "rejected_by",
  });
  ProformaInvoice.hasMany(ProformaInvoiceItem, {
    as: "items",
    foreignKey: "proforma_invoice_id",
  });

  // ProformaInvoiceItem associations
  ProformaInvoiceItem.belongsTo(ProformaInvoice, {
    as: "proformaInvoice",
    foreignKey: "proforma_invoice_id",
  });
  ProformaInvoiceItem.belongsTo(Product, {
    as: "product",
    foreignKey: "product_id",
  });
  ProformaInvoiceItem.belongsTo(TaxCode, {
    as: "salesTaxCode",
    foreignKey: "sales_tax_id",
  });
  ProformaInvoiceItem.belongsTo(TaxCode, {
    as: "whtTaxCode",
    foreignKey: "wht_tax_id",
  });
  ProformaInvoiceItem.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  ProformaInvoiceItem.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  ProformaInvoiceItem.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // Reverse associations
  Store.hasMany(ProformaInvoice, {
    as: "proformaInvoices",
    foreignKey: "store_id",
  });
  Customer.hasMany(ProformaInvoice, {
    as: "proformaInvoices",
    foreignKey: "customer_id",
  });
  Currency.hasMany(ProformaInvoice, {
    as: "proformaInvoices",
    foreignKey: "currency_id",
  });
  Currency.hasMany(ProformaInvoice, {
    as: "systemDefaultProformaInvoices",
    foreignKey: "system_default_currency_id",
  });
  ExchangeRate.hasMany(ProformaInvoice, {
    as: "proformaInvoices",
    foreignKey: "exchange_rate_id",
  });
  User.hasMany(ProformaInvoice, {
    as: "createdProformaInvoices",
    foreignKey: "created_by",
  });
  User.hasMany(ProformaInvoice, {
    as: "updatedProformaInvoices",
    foreignKey: "updated_by",
  });
  User.hasMany(ProformaInvoice, {
    as: "sentProformaInvoices",
    foreignKey: "sent_by",
  });
  User.hasMany(ProformaInvoice, {
    as: "acceptedProformaInvoices",
    foreignKey: "accepted_by",
  });
  User.hasMany(ProformaInvoice, {
    as: "rejectedProformaInvoices",
    foreignKey: "rejected_by",
  });
  User.hasMany(ProformaInvoiceItem, {
    as: "createdProformaInvoiceItems",
    foreignKey: "created_by",
  });
  User.hasMany(ProformaInvoiceItem, {
    as: "updatedProformaInvoiceItems",
    foreignKey: "updated_by",
  });
  Product.hasMany(ProformaInvoiceItem, {
    as: "proformaInvoiceItems",
    foreignKey: "product_id",
  });

  // SalesOrder associations
  SalesOrder.belongsTo(Store, { as: "store", foreignKey: "store_id" });
  SalesOrder.belongsTo(Customer, { as: "customer", foreignKey: "customer_id" });
  SalesOrder.belongsTo(Currency, { as: "currency", foreignKey: "currency_id" });
  SalesOrder.belongsTo(Currency, {
    as: "systemDefaultCurrency",
    foreignKey: "system_default_currency_id",
  });
  SalesOrder.belongsTo(ExchangeRate, {
    as: "exchangeRate",
    foreignKey: "exchange_rate_id",
  });
  SalesOrder.belongsTo(PriceCategory, {
    as: "priceCategory",
    foreignKey: "price_category_id",
  });
  SalesOrder.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  SalesOrder.belongsTo(User, { as: "createdByUser", foreignKey: "created_by" });
  SalesOrder.belongsTo(User, { as: "updatedByUser", foreignKey: "updated_by" });
  SalesOrder.belongsTo(User, { as: "sentByUser", foreignKey: "sent_by" });
  SalesOrder.belongsTo(User, {
    as: "acceptedByUser",
    foreignKey: "accepted_by",
  });
  SalesOrder.belongsTo(User, {
    as: "rejectedByUser",
    foreignKey: "rejected_by",
  });
  SalesOrder.belongsTo(User, {
    as: "fulfilledByUser",
    foreignKey: "fulfilled_by",
  });
  SalesOrder.hasMany(SalesOrderItem, {
    as: "items",
    foreignKey: "sales_order_id",
  });

  // SalesOrderItem associations
  SalesOrderItem.belongsTo(SalesOrder, {
    as: "salesOrder",
    foreignKey: "sales_order_id",
  });
  SalesOrderItem.belongsTo(Product, {
    as: "product",
    foreignKey: "product_id",
  });
  SalesOrderItem.belongsTo(TaxCode, {
    as: "salesTaxCode",
    foreignKey: "sales_tax_id",
  });
  SalesOrderItem.belongsTo(TaxCode, {
    as: "whtTaxCode",
    foreignKey: "wht_tax_id",
  });
  SalesOrderItem.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  SalesOrderItem.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  SalesOrderItem.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  SalesOrderItem.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // Reverse associations
  Store.hasMany(SalesOrder, { as: "salesOrders", foreignKey: "store_id" });
  Customer.hasMany(SalesOrder, {
    as: "salesOrders",
    foreignKey: "customer_id",
  });
  Currency.hasMany(SalesOrder, {
    as: "salesOrders",
    foreignKey: "currency_id",
  });
  Currency.hasMany(SalesOrder, {
    as: "systemDefaultSalesOrders",
    foreignKey: "system_default_currency_id",
  });
  ExchangeRate.hasMany(SalesOrder, {
    as: "salesOrders",
    foreignKey: "exchange_rate_id",
  });
  User.hasMany(SalesOrder, {
    as: "createdSalesOrders",
    foreignKey: "created_by",
  });
  User.hasMany(SalesOrder, {
    as: "updatedSalesOrders",
    foreignKey: "updated_by",
  });
  User.hasMany(SalesOrder, { as: "sentSalesOrders", foreignKey: "sent_by" });
  User.hasMany(SalesOrder, {
    as: "acceptedSalesOrders",
    foreignKey: "accepted_by",
  });
  User.hasMany(SalesOrder, {
    as: "rejectedSalesOrders",
    foreignKey: "rejected_by",
  });
  User.hasMany(SalesOrder, {
    as: "fulfilledSalesOrders",
    foreignKey: "fulfilled_by",
  });
  User.hasMany(SalesOrderItem, {
    as: "createdSalesOrderItems",
    foreignKey: "created_by",
  });
  User.hasMany(SalesOrderItem, {
    as: "updatedSalesOrderItems",
    foreignKey: "updated_by",
  });
  Product.hasMany(SalesOrderItem, {
    as: "salesOrderItems",
    foreignKey: "product_id",
  });

  // SalesInvoice associations
  SalesInvoice.belongsTo(Store, { as: "store", foreignKey: "store_id" });
  SalesInvoice.belongsTo(Customer, {
    as: "customer",
    foreignKey: "customer_id",
  });
  SalesInvoice.belongsTo(SalesOrder, {
    as: "salesOrder",
    foreignKey: "sales_order_id",
  });
  SalesInvoice.belongsTo(ProformaInvoice, {
    as: "proformaInvoice",
    foreignKey: "proforma_invoice_id",
  });
  SalesInvoice.belongsTo(SalesAgent, {
    as: "salesAgent",
    foreignKey: "sales_agent_id",
  });
  SalesInvoice.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  SalesInvoice.belongsTo(Currency, {
    as: "systemDefaultCurrency",
    foreignKey: "system_default_currency_id",
  });
  SalesInvoice.belongsTo(ExchangeRate, {
    as: "exchangeRate",
    foreignKey: "exchange_rate_id",
  });
  SalesInvoice.belongsTo(PriceCategory, {
    as: "priceCategory",
    foreignKey: "price_category_id",
  });
  SalesInvoice.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  SalesInvoice.belongsTo(Account, {
    as: "discountAllowedAccount",
    foreignKey: "discount_allowed_account_id",
  });
  SalesInvoice.belongsTo(Account, {
    as: "accountReceivable",
    foreignKey: "account_receivable_id",
  });
  SalesInvoice.belongsTo(Company, { as: "company", foreignKey: "companyId" });
  SalesInvoice.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  SalesInvoice.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });
  SalesInvoice.belongsTo(User, { as: "sentByUser", foreignKey: "sent_by" });
  SalesInvoice.belongsTo(User, {
    as: "cancelledByUser",
    foreignKey: "cancelled_by",
  });
  SalesInvoice.belongsTo(User, {
    as: "rejectedByUser",
    foreignKey: "rejected_by",
  });
  SalesInvoice.belongsTo(User, {
    as: "approvedByUser",
    foreignKey: "approved_by",
  });
  SalesInvoice.hasMany(SalesInvoiceItem, {
    as: "items",
    foreignKey: "sales_invoice_id",
  });

  // LinkedAccount associations
  LinkedAccount.belongsTo(Company, { as: "company", foreignKey: "companyId" });
  LinkedAccount.belongsTo(Account, { as: "account", foreignKey: "account_id" });
  LinkedAccount.belongsTo(Customer, {
    as: "customer",
    foreignKey: "customer_id",
  });
  LinkedAccount.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  LinkedAccount.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // Reverse associations
  Company.hasMany(LinkedAccount, {
    as: "linkedAccounts",
    foreignKey: "companyId",
  });
  Account.hasMany(LinkedAccount, {
    as: "linkedAccountReferences",
    foreignKey: "account_id",
  });

  // SalesInvoiceItem associations
  SalesInvoiceItem.belongsTo(SalesInvoice, {
    as: "salesInvoice",
    foreignKey: "sales_invoice_id",
  });
  SalesInvoiceItem.belongsTo(Product, {
    as: "product",
    foreignKey: "product_id",
  });
  SalesInvoiceItem.belongsTo(TaxCode, {
    as: "salesTaxCode",
    foreignKey: "sales_tax_id",
  });
  SalesInvoiceItem.belongsTo(TaxCode, {
    as: "whtTaxCode",
    foreignKey: "wht_tax_id",
  });
  SalesInvoiceItem.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  SalesInvoiceItem.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  SalesInvoiceItem.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  SalesInvoiceItem.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });

  // Reverse associations
  Store.hasMany(SalesInvoice, { as: "salesInvoices", foreignKey: "store_id" });
  Customer.hasMany(SalesInvoice, {
    as: "salesInvoices",
    foreignKey: "customer_id",
  });
  SalesOrder.hasMany(SalesInvoice, {
    as: "salesInvoices",
    foreignKey: "sales_order_id",
  });
  ProformaInvoice.hasMany(SalesInvoice, {
    as: "salesInvoices",
    foreignKey: "proforma_invoice_id",
  });
  Currency.hasMany(SalesInvoice, {
    as: "salesInvoices",
    foreignKey: "currency_id",
  });
  Currency.hasMany(SalesInvoice, {
    as: "systemDefaultSalesInvoices",
    foreignKey: "system_default_currency_id",
  });
  ExchangeRate.hasMany(SalesInvoice, {
    as: "salesInvoices",
    foreignKey: "exchange_rate_id",
  });
  User.hasMany(SalesInvoice, {
    as: "createdSalesInvoices",
    foreignKey: "created_by",
  });
  User.hasMany(SalesInvoice, {
    as: "updatedSalesInvoices",
    foreignKey: "updated_by",
  });
  User.hasMany(SalesInvoice, {
    as: "sentSalesInvoices",
    foreignKey: "sent_by",
  });
  User.hasMany(SalesInvoice, {
    as: "cancelledSalesInvoices",
    foreignKey: "cancelled_by",
  });
  User.hasMany(SalesInvoice, {
    as: "rejectedSalesInvoices",
    foreignKey: "rejected_by",
  });
  User.hasMany(SalesInvoice, {
    as: "approvedSalesInvoices",
    foreignKey: "approved_by",
  });
  User.hasMany(SalesInvoiceItem, {
    as: "createdSalesInvoiceItems",
    foreignKey: "created_by",
  });
  User.hasMany(SalesInvoiceItem, {
    as: "updatedSalesInvoiceItems",
    foreignKey: "updated_by",
  });
  Product.hasMany(SalesInvoiceItem, {
    as: "salesInvoiceItems",
    foreignKey: "product_id",
  });

  // SalesTransaction associations
  SalesTransaction.belongsTo(Company, {
    as: "company",
    foreignKey: "companyId",
  });
  SalesTransaction.belongsTo(Store, { as: "store", foreignKey: "store_id" });
  SalesTransaction.belongsTo(Customer, {
    as: "customer",
    foreignKey: "customer_id",
  });
  SalesTransaction.belongsTo(SalesAgent, {
    as: "salesAgent",
    foreignKey: "sales_agent_id",
  });
  SalesTransaction.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  SalesTransaction.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  SalesTransaction.belongsTo(Currency, {
    as: "systemDefaultCurrency",
    foreignKey: "system_default_currency_id",
  });
  SalesTransaction.belongsTo(ExchangeRate, {
    as: "exchangeRate",
    foreignKey: "exchange_rate_id",
  });
  SalesTransaction.belongsTo(SalesInvoice, {
    as: "sourceInvoice",
    foreignKey: "source_invoice_id",
  });
  SalesTransaction.belongsTo(SalesOrder, {
    as: "sourceOrder",
    foreignKey: "source_order_id",
  });
  SalesTransaction.belongsTo(SalesTransaction, {
    as: "sourceTransaction",
    foreignKey: "source_transaction_id",
  });
  SalesTransaction.belongsTo(SalesTransaction, {
    as: "parentTransaction",
    foreignKey: "parent_transaction_id",
  });
  SalesTransaction.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by",
  });
  SalesTransaction.belongsTo(User, {
    as: "updatedByUser",
    foreignKey: "updated_by",
  });
  SalesTransaction.belongsTo(User, { as: "sentByUser", foreignKey: "sent_by" });
  SalesTransaction.belongsTo(User, {
    as: "approvedByUser",
    foreignKey: "approved_by",
  });
  SalesTransaction.belongsTo(User, {
    as: "cancelledByUser",
    foreignKey: "cancelled_by",
  });
  SalesTransaction.belongsTo(User, {
    as: "rejectedByUser",
    foreignKey: "rejected_by",
  });
  // Product attribute associations
  SalesTransaction.belongsTo(Product, {
    as: "product",
    foreignKey: "product_id",
  });
  SalesTransaction.belongsTo(ProductCategory, {
    as: "productCategory",
    foreignKey: "product_category_id",
  });
  SalesTransaction.belongsTo(ProductBrandName, {
    as: "brandName",
    foreignKey: "brand_name_id",
  });
  SalesTransaction.belongsTo(ProductManufacturer, {
    as: "manufacturer",
    foreignKey: "manufacturer_id",
  });
  SalesTransaction.belongsTo(ProductModel, {
    as: "model",
    foreignKey: "model_id",
  });
  SalesTransaction.belongsTo(ProductColor, {
    as: "color",
    foreignKey: "color_id",
  });
  SalesTransaction.belongsTo(Packaging, {
    as: "packaging",
    foreignKey: "packaging_id",
  });
  SalesTransaction.belongsTo(PriceCategory, {
    as: "priceCategory",
    foreignKey: "price_category_id",
  });
  SalesTransaction.belongsTo(ProductStoreLocation, {
    as: "storeLocation",
    foreignKey: "store_location_id",
  });

  // Reverse associations
  Company.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "companyId",
  });
  Store.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "store_id",
  });
  Customer.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "customer_id",
  });
  SalesAgent.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "sales_agent_id",
  });
  FinancialYear.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "financial_year_id",
  });
  Currency.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "currency_id",
  });
  Currency.hasMany(SalesTransaction, {
    as: "systemDefaultSalesTransactions",
    foreignKey: "system_default_currency_id",
  });
  ExchangeRate.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "exchange_rate_id",
  });
  SalesInvoice.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "source_invoice_id",
  });
  SalesOrder.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "source_order_id",
  });
  SalesTransaction.hasMany(SalesTransaction, {
    as: "childTransactions",
    foreignKey: "parent_transaction_id",
  });
  SalesTransaction.hasMany(SalesTransaction, {
    as: "relatedTransactions",
    foreignKey: "source_transaction_id",
  });
  User.hasMany(SalesTransaction, {
    as: "createdSalesTransactions",
    foreignKey: "created_by",
  });
  User.hasMany(SalesTransaction, {
    as: "updatedSalesTransactions",
    foreignKey: "updated_by",
  });
  User.hasMany(SalesTransaction, {
    as: "sentSalesTransactions",
    foreignKey: "sent_by",
  });
  User.hasMany(SalesTransaction, {
    as: "approvedSalesTransactions",
    foreignKey: "approved_by",
  });
  User.hasMany(SalesTransaction, {
    as: "cancelledSalesTransactions",
    foreignKey: "cancelled_by",
  });
  User.hasMany(SalesTransaction, {
    as: "rejectedSalesTransactions",
    foreignKey: "rejected_by",
  });
  // Product attribute reverse associations
  ProductCategory.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "product_category_id",
  });
  ProductBrandName.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "brand_name_id",
  });
  ProductManufacturer.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "manufacturer_id",
  });
  ProductModel.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "model_id",
  });
  ProductColor.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "color_id",
  });
  Packaging.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "packaging_id",
  });
  PriceCategory.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "price_category_id",
  });
  ProductStoreLocation.hasMany(SalesTransaction, {
    as: "salesTransactions",
    foreignKey: "store_location_id",
  });

  // LoyaltyTransaction associations
  LoyaltyTransaction.belongsTo(Company, {
    as: "company",
    foreignKey: "companyId",
  });
  LoyaltyTransaction.belongsTo(LoyaltyCard, {
    as: "loyaltyCard",
    foreignKey: "loyalty_card_id",
  });
  LoyaltyTransaction.belongsTo(SalesInvoice, {
    as: "salesInvoice",
    foreignKey: "sales_invoice_id",
  });
  LoyaltyTransaction.belongsTo(SalesOrder, {
    as: "salesOrder",
    foreignKey: "sales_order_id",
  });
  LoyaltyTransaction.belongsTo(SalesTransaction, {
    as: "salesTransaction",
    foreignKey: "sales_transaction_id",
  });
  LoyaltyTransaction.belongsTo(Customer, {
    as: "customer",
    foreignKey: "customer_id",
  });
  LoyaltyTransaction.belongsTo(Store, { as: "store", foreignKey: "store_id" });
  LoyaltyTransaction.belongsTo(LoyaltyCardConfig, {
    as: "loyaltyConfig",
    foreignKey: "loyalty_config_id",
  });
  LoyaltyTransaction.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  LoyaltyTransaction.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  LoyaltyTransaction.belongsTo(User, {
    as: "creator",
    foreignKey: "created_by",
  });
  LoyaltyTransaction.belongsTo(User, {
    as: "updater",
    foreignKey: "updated_by",
  });

  // Reverse associations
  Company.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "companyId",
  });
  LoyaltyCard.hasMany(LoyaltyTransaction, {
    as: "transactions",
    foreignKey: "loyalty_card_id",
  });
  SalesInvoice.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "sales_invoice_id",
  });
  SalesOrder.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "sales_order_id",
  });
  SalesTransaction.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "sales_transaction_id",
  });
  Customer.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "customer_id",
  });

  // Receipt associations
  Receipt.belongsTo(SalesInvoice, {
    as: "salesInvoice",
    foreignKey: "sales_invoice_id",
  });
  Receipt.belongsTo(Customer, { as: "customer", foreignKey: "customer_id" });
  Receipt.belongsTo(SalesAgent, {
    as: "salesAgent",
    foreignKey: "sales_agent_id",
  });
  Receipt.belongsTo(Currency, { as: "currency", foreignKey: "currency_id" });
  Receipt.belongsTo(Currency, {
    as: "systemDefaultCurrency",
    foreignKey: "system_default_currency_id",
  });
  Receipt.belongsTo(ExchangeRate, {
    as: "exchangeRateRecord",
    foreignKey: "exchange_rate_id",
  });
  Receipt.belongsTo(PaymentType, {
    as: "paymentType",
    foreignKey: "payment_type_id",
  });
  Receipt.belongsTo(BankDetail, {
    as: "bankDetail",
    foreignKey: "bank_detail_id",
  });
  Receipt.belongsTo(Account, {
    as: "receivableAccount",
    foreignKey: "receivable_account_id",
  });
  Receipt.belongsTo(Account, {
    as: "assetAccount",
    foreignKey: "asset_account_id",
  });
  Receipt.belongsTo(Account, {
    as: "liabilityAccount",
    foreignKey: "liability_account_id",
  });
  Receipt.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  Receipt.belongsTo(Company, { as: "company", foreignKey: "companyId" });
  Receipt.belongsTo(User, { as: "createdByUser", foreignKey: "created_by" });
  Receipt.belongsTo(User, { as: "updatedByUser", foreignKey: "updated_by" });
  Receipt.belongsTo(User, { as: "reversedByUser", foreignKey: "reversed_by" });
  Receipt.hasMany(ReceiptItem, { as: "items", foreignKey: "receipt_id" });
  Receipt.hasMany(ReceiptTransaction, {
    as: "transactions",
    foreignKey: "receipt_id",
  });

  // ReceiptItem associations
  ReceiptItem.belongsTo(Receipt, { as: "receipt", foreignKey: "receipt_id" });
  ReceiptItem.belongsTo(SalesInvoice, {
    as: "salesInvoice",
    foreignKey: "sales_invoice_id",
  });
  ReceiptItem.belongsTo(SalesInvoiceItem, {
    as: "salesInvoiceItem",
    foreignKey: "sales_invoice_item_id",
  });
  ReceiptItem.belongsTo(SalesAgent, {
    as: "salesAgent",
    foreignKey: "sales_agent_id",
  });
  ReceiptItem.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  ReceiptItem.belongsTo(Currency, {
    as: "systemDefaultCurrency",
    foreignKey: "system_default_currency_id",
  });
  ReceiptItem.belongsTo(ExchangeRate, {
    as: "exchangeRateRecord",
    foreignKey: "exchange_rate_id",
  });
  ReceiptItem.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  ReceiptItem.belongsTo(Company, { as: "company", foreignKey: "companyId" });

  // ReceiptTransaction associations
  ReceiptTransaction.belongsTo(Receipt, {
    as: "receipt",
    foreignKey: "receipt_id",
  });
  ReceiptTransaction.belongsTo(SalesInvoice, {
    as: "salesInvoice",
    foreignKey: "sales_invoice_id",
  });
  ReceiptTransaction.belongsTo(Store, { as: "store", foreignKey: "store_id" });
  ReceiptTransaction.belongsTo(Customer, {
    as: "customer",
    foreignKey: "customer_id",
  });
  ReceiptTransaction.belongsTo(SalesAgent, {
    as: "salesAgent",
    foreignKey: "sales_agent_id",
  });
  ReceiptTransaction.belongsTo(PaymentType, {
    as: "paymentType",
    foreignKey: "payment_type_id",
  });
  ReceiptTransaction.belongsTo(BankDetail, {
    as: "bankDetail",
    foreignKey: "bank_detail_id",
  });
  ReceiptTransaction.belongsTo(Currency, {
    as: "currency",
    foreignKey: "currency_id",
  });
  ReceiptTransaction.belongsTo(Currency, {
    as: "systemCurrency",
    foreignKey: "system_currency_id",
  });
  ReceiptTransaction.belongsTo(ExchangeRate, {
    as: "exchangeRateRecord",
    foreignKey: "exchange_rate_id",
  });
  ReceiptTransaction.belongsTo(Account, {
    as: "receivableAccount",
    foreignKey: "receivable_account_id",
  });
  ReceiptTransaction.belongsTo(Account, {
    as: "assetAccount",
    foreignKey: "asset_account_id",
  });
  ReceiptTransaction.belongsTo(Account, {
    as: "liabilityAccount",
    foreignKey: "liability_account_id",
  });
  ReceiptTransaction.belongsTo(Account, {
    as: "loyaltyAccount",
    foreignKey: "loyalty_account_id",
  });
  ReceiptTransaction.belongsTo(FinancialYear, {
    as: "financialYear",
    foreignKey: "financial_year_id",
  });
  ReceiptTransaction.belongsTo(TransactionType, {
    as: "transactionType",
    foreignKey: "transaction_type_id",
  });
  ReceiptTransaction.belongsTo(Company, {
    as: "company",
    foreignKey: "companyId",
  });
  ReceiptTransaction.belongsTo(User, {
    as: "createdByUser",
    foreignKey: "created_by_id",
  });

  // Reverse associations
  SalesInvoice.hasMany(Receipt, {
    as: "receipts",
    foreignKey: "sales_invoice_id",
  });
  Customer.hasMany(Receipt, { as: "receipts", foreignKey: "customer_id" });
  SalesAgent.hasMany(Receipt, { as: "receipts", foreignKey: "sales_agent_id" });
  SalesInvoiceItem.hasMany(ReceiptItem, {
    as: "receiptItems",
    foreignKey: "sales_invoice_item_id",
  });
  Store.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "store_id",
  });
  LoyaltyCardConfig.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "loyalty_config_id",
  });
  FinancialYear.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "financial_year_id",
  });
  Currency.hasMany(LoyaltyTransaction, {
    as: "loyaltyTransactions",
    foreignKey: "currency_id",
  });
  User.hasMany(LoyaltyTransaction, {
    as: "createdLoyaltyTransactions",
    foreignKey: "created_by",
  });
  User.hasMany(LoyaltyTransaction, {
    as: "updatedLoyaltyTransactions",
    foreignKey: "updated_by",
  });
}

module.exports = setupAssociations;
