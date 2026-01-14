const { Model, DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

class PurchaseInvoice extends Model {}

PurchaseInvoice.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    invoiceNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "invoice_number",
    },
    invoiceDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: "invoice_date",
    },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: "due_date" },
    vendorId: { type: DataTypes.UUID, allowNull: false, field: "vendor_id" },
    storeId: { type: DataTypes.UUID, allowNull: true, field: "store_id" },
    purchaseOrderId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "purchase_order_id",
    },
    currencyId: { type: DataTypes.UUID, allowNull: true, field: "currency_id" },
    exchangeRate: {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: false,
      defaultValue: 1,
      field: "exchange_rate",
    },
    reference: { type: DataTypes.STRING, allowNull: true },
    status: {
      type: DataTypes.ENUM(
        "draft",
        "posted",
        "partially_paid",
        "paid",
        "cancelled"
      ),
      allowNull: false,
      defaultValue: "draft",
    },
    subtotalAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "subtotal_amount",
    },
    discountAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "discount_amount",
    },
    taxAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "tax_amount",
    },
    shippingCost: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "shipping_cost",
    },
    totalAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "total_amount",
    },
    balanceDue: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "balance_due",
    },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.UUID, allowNull: false, field: "created_by" },
    updatedBy: { type: DataTypes.UUID, allowNull: true, field: "updated_by" },
    companyId: { type: DataTypes.UUID, allowNull: false, field: "companyId" },
  },
  {
    sequelize,
    modelName: "PurchaseInvoice",
    tableName: "purchase_invoices",
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    paranoid: true,
    deletedAt: "deleted_at",
  }
);

module.exports = PurchaseInvoice;
