const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ReturnReason = sequelize.define('ReturnReason', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 50]
        },

    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    return_type: {
        type: DataTypes.ENUM('full_refund', 'partial_refund', 'exchange', 'store_credit'),
        allowNull: false,
        validate: {
            isIn: [['full_refund', 'partial_refund', 'exchange', 'store_credit']]
        }
    },
    requires_approval: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    max_return_days: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: 0,
            max: 365
        }
    },
    refund_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    inventory_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    created_by: {
        type: DataTypes.UUID,
        allowNull: true,
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
    tableName: 'return_reasons',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'return_reasons_code_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['name']
        },
        {
            fields: ['return_type']
        },
        {
            fields: ['is_active']
        },
        {
            fields: ['requires_approval']
        }
    ]
});

// Associations are defined in associations.js

module.exports = ReturnReason;
