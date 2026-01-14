const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class PurchaseInvoicePayment extends Model {}

PurchaseInvoicePayment.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  purchaseInvoiceId: { type: DataTypes.UUID, allowNull: false, field: 'purchase_invoice_id' },
  paidAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'paid_at' },
  amount: { type: DataTypes.DECIMAL(18,2), allowNull: false },
  method: { type: DataTypes.STRING, allowNull: true },
  reference: { type: DataTypes.STRING, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false, field: 'created_by' }
}, {
  sequelize,
  modelName: 'PurchaseInvoicePayment',
  tableName: 'purchase_invoice_payments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = PurchaseInvoicePayment;
