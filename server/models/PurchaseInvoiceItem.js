const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class PurchaseInvoiceItem extends Model {}

PurchaseInvoiceItem.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  purchaseInvoiceId: { type: DataTypes.UUID, allowNull: false, field: 'purchase_invoice_id' },
  productId: { type: DataTypes.UUID, allowNull: true, field: 'product_id' },
  description: { type: DataTypes.TEXT, allowNull: true },
  quantity: { type: DataTypes.DECIMAL(18,3), allowNull: false },
  unitPrice: { type: DataTypes.DECIMAL(18,2), allowNull: false, field: 'unit_price' },
  discountPercentage: { type: DataTypes.DECIMAL(5,2), allowNull: true, field: 'discount_percentage' },
  discountAmount: { type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'discount_amount' },
  taxPercentage: { type: DataTypes.DECIMAL(5,2), allowNull: true, field: 'tax_percentage' },
  taxAmount: { type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'tax_amount' },
  lineSubtotal: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'line_subtotal' },
  lineTotal: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'line_total' }
}, {
  sequelize,
  modelName: 'PurchaseInvoiceItem',
  tableName: 'purchase_invoice_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = PurchaseInvoiceItem;
