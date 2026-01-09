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
        // DB column uses snake_case naming
        field: 'journal_entry_id',
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
        field: 'account_id',
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
        field: 'account_type_id',
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
        field: 'original_amount',

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
        field: 'currency_id',
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
        field: 'exchange_rate_id',
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
        field: 'exchange_rate',

    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,

    },
    lineNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        field: 'line_number',

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
            // index on DB column name
            fields: ['journal_entry_id']
        },
        {
            fields: ['account_id']
        },
        {
            fields: ['account_type_id']
        },
        {
            fields: ['currency_id']
        },
        {
            fields: ['journal_entry_id', 'line_number']
        }
    ]
});

module.exports = JournalEntryLine;

