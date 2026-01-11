const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class ReturnOut extends Model {}

ReturnOut.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    returnDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'return_date'
    },
    storeId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'store_id'
    },
    vendorId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'vendor_id'
    },
    returnReasonId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'return_reason_id'
    },
    currencyId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'currency_id'
    },
    exchangeRate: {
        type: DataTypes.DECIMAL(18,6),
        allowNull: false,
        defaultValue: 1,
        field: 'exchange_rate'
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    totalAmount: {
        type: DataTypes.DECIMAL(18,2),
        allowNull: false,
        defaultValue: 0,
        field: 'total_amount'
    },
    status: {
        type: DataTypes.ENUM('draft','confirmed','cancelled'),
        allowNull: false,
        defaultValue: 'draft'
    },
    createdBy: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'created_by'
    },
    updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'updated_by'
    },
    companyId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'companyId'
    }
}, {
    sequelize,
    modelName: 'ReturnOut',
    tableName: 'return_outs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
        { fields: ['store_id'] },
        { fields: ['vendor_id'] },
        { fields: ['return_reason_id'] },
        { fields: ['currency_id'] },
        { fields: ['companyId'] }
    ]
});

module.exports = ReturnOut;
