const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class Account extends Model {}

Account.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    code: {
        type: DataTypes.STRING,
        allowNull: false,

    },
    type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    nature: {
        type: DataTypes.ENUM('DEBIT', 'CREDIT'),
        allowNull: false
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
        onUpdate: 'CASCADE'
    },
    parentId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'parentId',
        references: {
            model: 'accounts',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    },
    description: {
        type: DataTypes.STRING,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
        allowNull: false
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
    modelName: 'Account',
    tableName: 'accounts',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'accounts_code_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['code']
        },
        {
            fields: ['accountTypeId']
        },
        {
            fields: ['parentId']
        }
    ]
});

module.exports = Account; 