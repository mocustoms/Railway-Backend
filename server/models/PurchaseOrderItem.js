const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class PurchaseOrderItem extends Model {}

PurchaseOrderItem.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  purchaseOrderId: { type: DataTypes.UUID, allowNull: false, field: 'purchase_order_id' },
  productId: { type: DataTypes.UUID, allowNull: false, field: 'product_id' },
  quantityOrdered: { type: DataTypes.DECIMAL(18,3), allowNull: false, field: 'quantity_ordered' },
  quantityReceived: { type: DataTypes.DECIMAL(18,3), allowNull: false, defaultValue: 0, field: 'quantity_received' },
  unitPrice: { type: DataTypes.DECIMAL(18,2), allowNull: false, field: 'unit_price' },
  discountPercentage: { type: DataTypes.DECIMAL(5,2), allowNull: true, field: 'discount_percentage' },
  discountAmount: { type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'discount_amount' },
  taxPercentage: { type: DataTypes.DECIMAL(5,2), allowNull: true, field: 'tax_percentage' },
  taxAmount: { type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'tax_amount' },
  lineSubtotal: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'line_subtotal' },
  lineTotal: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'line_total' },
  notes: { type: DataTypes.TEXT, allowNull: true }
}, {
  sequelize,
  modelName: 'PurchaseOrderItem',
  tableName: 'purchase_order_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = PurchaseOrderItem;
