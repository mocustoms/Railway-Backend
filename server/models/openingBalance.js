const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class OpeningBalance extends Model {}

OpeningBalance.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    accountId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'accounts',
            key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    accountTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'account_types',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',

    },
    amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,

    },
    originalAmount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,

    },
    type: {
        type: DataTypes.ENUM('debit', 'credit'),
        allowNull: false,
        defaultValue: 'debit'
    },
    nature: {
        type: DataTypes.ENUM('DEBIT', 'CREDIT'),
        allowNull: true
    },
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    description: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // Currency and Exchange Rate fields
    currencyId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'currencies',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',

    },
    exchangeRateId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'exchange_rates',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',

    },
    exchangeRate: {
        type: DataTypes.DECIMAL(15, 6),
        allowNull: true,

    },
    // Financial Year field
    financialYearId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'financial_years',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',

    },
    createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    },
    updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    },
    equivalentAmount: {
        type: DataTypes.DECIMAL(24, 4),
        allowNull: true,
        defaultValue: 0,

    },
    transactionTypeId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'transactionTypeId',
        references: {
            model: 'transaction_types',
            key: 'id'
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',

    },
    referenceNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'referenceNumber',
        // unique: true removed - using composite unique index with companyId instead
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    companyId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'companyId', // Explicitly set field name
        references: {
            model: 'company',
            key: 'id'
        },

    }
}, {
    sequelize,
    modelName: 'OpeningBalance',
    tableName: 'openingBalances',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [
        {
            fields: ['currencyId']
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['financialYearId']
        },
        {
            fields: ['exchangeRateId']
        },
        {
            fields: ['accountId', 'financialYearId']
        },
        {
            fields: ['accountTypeId']
        },
        {
            fields: ['transactionTypeId']
        },
        {
            unique: true,
            fields: ['referenceNumber', 'companyId'],
            name: 'openingBalances_referenceNumber_companyId_unique'
        }
    ]
});

module.exports = OpeningBalance; 