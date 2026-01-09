const sequelize = require('../../config/database');
const { DataTypes } = require('sequelize');
const User = require('./user');
const Account = require('./account');
const Company = require('./company');
const Store = require('./store');
const AccountType = require('./accountType');
const AccountTypeAudit = require('./accountTypeAudit')(sequelize);
const OpeningBalance = require('./openingBalance');
const FinancialYear = require('./financialYear');
const UserStore = require('./userStore');
const Currency = require('./currency');
const ExchangeRate = require('./exchangeRate');
const PaymentMethod = require('./paymentMethod')(sequelize);
const PaymentType = require('./paymentType')(sequelize);
const BankDetail = require('./BankDetail')(sequelize);
const TaxCode = require('./taxCode');
const AdjustmentReason = require('./adjustmentReason');
const ReturnReason = require('./returnReason');
const ProductCategory = require('./productCategory');
const ProductModel = require('./productModel');
const Product = require('./product');
const ProductStoreLocation = require('./productStoreLocation');
const ProductColor = require('./productColor');
const Packaging = require('./packaging');
const setupAssociations = require('./associations');
const ProductManufacturer = require('./productManufacturer');
const ProductBrandName = require('./productBrandName');
const PriceCategory = require('./priceCategory');
const ProductPriceCategory = require('./productPriceCategory');
const ProductManufacturingInfo = require('./productManufacturingInfo')(sequelize, DataTypes);
const ProductRawMaterial = require('./productRawMaterial')(sequelize, DataTypes);
const ProductPharmaceuticalInfo = require('./productPharmaceuticalInfo')(sequelize, DataTypes);
const ProductDosage = require('./productDosage')(sequelize, DataTypes);
const ProductStore = require('./productStore');
const ProductSerialNumber = require('./productSerialNumber');
const ProductExpiryDate = require('./productExpiryDate');
const ProductTransaction = require('./productTransaction');
const GeneralLedger = require('./generalLedger');
const Transaction = require('./transaction');
const TransactionType = require('./transactionType');
const CostingMethod = require('./costingMethod');
const PriceChangeReason = require('./priceChangeReason');
const PriceHistory = require('./priceHistory');
const PhysicalInventory = require('./physicalInventory')(sequelize);
const PhysicalInventoryItem = require('./physicalInventoryItem')(sequelize);
// const PhysicalInventoryReversal = require('./physicalInventoryReversal');
const StockAdjustment = require('./stockAdjustment')(sequelize);
const StockAdjustmentItem = require('./stockAdjustmentItem')(sequelize);
const StoreRequest = require('./storeRequest')(sequelize);
const StoreRequestItem = require('./storeRequestItem')(sequelize);
const StoreRequestItemTransaction = require('./storeRequestItemTransaction')(sequelize);
const SalesAgent = require('./salesAgent');
const CustomerDeposit = require('./CustomerDeposit')(sequelize);
const CustomerGroup = require('./customerGroup');
const Customer = require('./Customer');
const ProformaInvoice = require('./proformaInvoice')(sequelize);
const ProformaInvoiceItem = require('./proformaInvoiceItem')(sequelize);
const SalesOrder = require('./salesOrder')(sequelize);
const SalesOrderItem = require('./salesOrderItem')(sequelize);
const SalesInvoice = require('./salesInvoice')(sequelize);
const SalesInvoiceItem = require('./salesInvoiceItem')(sequelize);
const SalesTransaction = require('./salesTransaction')(sequelize);
const LinkedAccount = require('./linkedAccount')(sequelize);
const LoyaltyCard = require('./LoyaltyCard')(sequelize);
const LoyaltyCardConfig = require('./LoyaltyCardConfig')(sequelize);
const LoyaltyConfig = require('./LoyaltyConfig')(sequelize);
const LoyaltyTransaction = require('./LoyaltyTransaction')(sequelize);
const Receipt = require('./receipt')(sequelize);
const ReceiptItem = require('./receiptItem')(sequelize);
const ReceiptTransaction = require('./receiptTransaction')(sequelize);
const JournalEntry = require('./journalEntry');
const JournalEntryLine = require('./journalEntryLine');
const Supplier = require('./supplier');
const Vendor = require('./vendor');
const VendorGroup = require('./vendorGroup');
const VendorProduct = require('./vendorProduct')(sequelize, DataTypes);

// Set up associations
const models = {
    User,
    Account,
    Company,
    Store,
    AccountType,
    AccountTypeAudit,
    OpeningBalance,
    FinancialYear,
    UserStore,
    Currency,
    ExchangeRate,
    PaymentMethod,
    PaymentType,
    BankDetail,
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
    ProductManufacturingInfo,
    ProductRawMaterial,
    ProductPharmaceuticalInfo,
    ProductDosage,
    ProductStore,
    ProductSerialNumber,
    ProductExpiryDate,
    ProductTransaction,
    GeneralLedger,
    Transaction,
    TransactionType,
    CostingMethod,
    PriceChangeReason,
    PriceHistory,
    PhysicalInventory,
    PhysicalInventoryItem,
    // PhysicalInventoryReversal,
    StockAdjustment,
    StockAdjustmentItem,
    StoreRequest,
    StoreRequestItem,
    StoreRequestItemTransaction,
    SalesAgent,
    CustomerDeposit,
    CustomerGroup,
    Customer,
    ProformaInvoice,
    ProformaInvoiceItem,
    SalesOrder,
    SalesOrderItem,
    SalesInvoice,
    SalesInvoiceItem,
    SalesTransaction,
    LinkedAccount,
    LoyaltyCard,
    LoyaltyCardConfig,
    LoyaltyConfig,
    LoyaltyTransaction,
    Receipt,
    ReceiptItem,
    ReceiptTransaction,
    JournalEntry,
    JournalEntryLine,
    Supplier,
    Vendor,
    VendorProduct,
    VendorGroup
};

// Call individual model associate methods
Object.values(models).forEach(model => {
    if (model.associate) {
        model.associate(models);
    }
});

// Set up additional associations
setupAssociations(models);

module.exports = {
    ...models,
    sequelize
}; 