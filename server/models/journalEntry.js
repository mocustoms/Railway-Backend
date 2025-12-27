const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class JournalEntry extends Model {}

JournalEntry.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    referenceNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        // unique: true removed - using composite unique index with companyId instead
        field: 'reference_number',
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    entryDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'entry_date',

    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,

    },
    financialYearId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'financial_year_id',
        references: {
            model: 'financial_years',
            key: 'id'
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',

    },
    totalDebit: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
        field: 'total_debit',
        validate: {
            min: 0
        },

    },
    totalCredit: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
        field: 'total_credit',
        validate: {
            min: 0
        },

    },
    isPosted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_posted',

    },
    postedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'posted_at',

    },
    postedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'posted_by',
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',

    },
    createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'created_by',
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
        field: 'updated_by',
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    },
    companyId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'companyId',
        references: {
            model: 'company',
            key: 'id'
        },

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

    }
}, {
    sequelize,
    modelName: 'JournalEntry',
    tableName: 'journal_entries',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['companyId']
        },
        {
            // Use actual DB column names for fields that are mapped via `field` option
            fields: ['financial_year_id']
        },
        {
            fields: ['entry_date']
        },
        {
            unique: true,
            fields: ['reference_number', 'companyId'],
            name: 'journal_entries_reference_number_companyId_unique'
        },
        {
            fields: ['is_posted']
        },
        {
            fields: ['created_by']
        },
        {
            fields: ['currency_id']
        }
    ]
});

module.exports = JournalEntry;

