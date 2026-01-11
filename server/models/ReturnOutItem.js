const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class ReturnOutItem extends Model {}

ReturnOutItem.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    returnOutId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'return_out_id'
    },
    productId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'product_id'
    },
    quantity: {
        type: DataTypes.DECIMAL(18,3),
        allowNull: false,
        defaultValue: 0
    },
    unitPrice: {
        type: DataTypes.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0,
        field: 'unit_price'
    },
    discountPercentage: {
        type: DataTypes.DECIMAL(5,2),
        allowNull: true,
        field: 'discount_percentage'
    },
    discountAmount: {
        type: DataTypes.DECIMAL(18,2),
        allowNull: true,
        field: 'discount_amount'
    },
    taxPercentage: {
        type: DataTypes.DECIMAL(5,2),
        allowNull: true,
        field: 'tax_percentage'
    },
    taxAmount: {
        type: DataTypes.DECIMAL(18,2),
        allowNull: true,
        field: 'tax_amount'
    },
    refundAmount: {
        type: DataTypes.DECIMAL(18,2),
        allowNull: true,
        field: 'refund_amount'
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    lineTotal: {
        type: DataTypes.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0,
        field: 'line_total'
    },
    companyId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'companyId'
    }
}, {
    sequelize,
    modelName: 'ReturnOutItem',
    tableName: 'return_out_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['return_out_id'] },
        { fields: ['product_id'] },
        { fields: ['companyId'] }
    ]
});

module.exports = ReturnOutItem;
