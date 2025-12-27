const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class JournalEntryLine extends Model {}

JournalEntryLine.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    journalEntryId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'journalEntryId',
        references: {
            model: 'journal_entries',
            key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',

    },
    accountId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'accountId',
        references: {
            model: 'accounts',
            key: 'id'
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',

    },
    accountTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'accountTypeId',
        references: {
            model: 'account_types',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',

    },
    type: {
        type: DataTypes.ENUM('debit', 'credit'),
        allowNull: false,

    },
    amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
        validate: {
            min: 0
        },

    },
    originalAmount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: 'originalAmount',

    },
    equivalentAmount: {
        type: DataTypes.DECIMAL(24, 4),
        allowNull: true,
        defaultValue: 0,
        field: 'equivalent_amount',

    },
    currencyId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'currencyId',
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
        field: 'exchangeRateId',
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
        defaultValue: 1.000000,
        field: 'exchangeRate',

    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,

    },
    lineNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        field: 'lineNumber',

    },
    companyId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'companyId',
        references: {
            model: 'company',
            key: 'id'
        },

    }
}, {
    sequelize,
    modelName: 'JournalEntryLine',
    tableName: 'journal_entry_lines',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['companyId']
        },
        {
            fields: ['journalEntryId']
        },
        {
            fields: ['accountId']
        },
        {
            fields: ['accountTypeId']
        },
        {
            fields: ['currencyId']
        },
        {
            fields: ['journalEntryId', 'lineNumber']
        }
    ]
});

module.exports = JournalEntryLine;

