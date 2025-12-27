const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const AccountType = sequelize.define('AccountType', {
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,

    },
    code: {
        type: DataTypes.STRING(50),
        allowNull: false,

    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    category: {
        type: DataTypes.ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'),
        allowNull: false
    },
    nature: {
        type: DataTypes.ENUM('DEBIT', 'CREDIT'),
        allowNull: false
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    created_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    updated_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
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
    tableName: 'account_types',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'account_types_code_companyId_unique'
        },
        {
            unique: true,
            fields: ['name', 'companyId'],
            name: 'account_types_name_companyId_unique'
        },
        {
            fields: ['companyId']
        }
    ]
});

module.exports = AccountType; 