'use strict';
const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class TransactionType extends Model {}

TransactionType.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        validate: {
            notEmpty: true,
            len: [1, 50],
            is: /^[a-zA-Z0-9_]+$/
        },
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
            notEmpty: true,
            len: [1, 100]
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    companyId: {
            type: DataTypes.UUID,
            allowNull: true, // Global data - can be null for shared reference data
            field: 'companyId', // Explicitly set field name
            references: {
               model: 'company',
                key: 'id'
            },

        }
}, {
    sequelize,
    modelName: 'TransactionType',
    tableName: 'transaction_types',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});

module.exports = TransactionType; 