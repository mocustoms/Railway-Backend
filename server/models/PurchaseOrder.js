const { Model, DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

class PurchaseOrder extends Model {}

PurchaseOrder.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    poNumber: { type: DataTypes.STRING, allowNull: true, field: "po_number" },
    orderDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: "order_date",
    },
    expectedDeliveryDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: "expected_delivery_date",
    },
    vendorId: { type: DataTypes.UUID, allowNull: false, field: "vendor_id" },
    storeId: { type: DataTypes.UUID, allowNull: false, field: "store_id" },
    currencyId: { type: DataTypes.UUID, allowNull: true, field: "currency_id" },
    exchangeRate: {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: false,
      defaultValue: 1,
      field: "exchange_rate",
    },
    shippingCost: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "shipping_cost",
    },
    subtotalAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "subtotal_amount",
    },
    taxAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "tax_amount",
    },
    discountAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "discount_amount",
    },
    totalAmount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      field: "total_amount",
    },
    status: {
      type: DataTypes.ENUM(
        "draft",
        "ordered",
        "partially_received",
        "received",
        "cancelled"
      ),
      allowNull: false,
      defaultValue: "draft",
    },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.UUID, allowNull: false, field: "created_by" },
    updatedBy: { type: DataTypes.UUID, allowNull: true, field: "updated_by" },
    companyId: { type: DataTypes.UUID, allowNull: false, field: "companyId" },
  },
  {
    sequelize,
    modelName: "PurchaseOrder",
    tableName: "purchase_orders",
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    paranoid: true,
    deletedAt: "deleted_at",
  }
);

module.exports = PurchaseOrder;
