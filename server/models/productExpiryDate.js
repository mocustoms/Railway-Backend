'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProductExpiryDate = sequelize.define('ProductExpiryDate', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    uuid: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        unique: true,
        allowNull: false
    },
    product_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    batch_number: {
        type: DataTypes.STRING,
        allowNull: true
    },
    expiry_date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    store_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    current_quantity: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    total_quantity_received: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    total_quantity_sold: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    total_quantity_adjusted: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    unit_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true
    },
    unit_cost_equivalent: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,

    },
    selling_price: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true
    },
    currency_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    exchange_rate: {
        type: DataTypes.DECIMAL(10, 6),
        allowNull: true
    },
    supplier_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    purchase_date: {
        type: DataTypes.DATE,
        allowNull: true
    },
    purchase_reference: {
        type: DataTypes.STRING,
        allowNull: true
    },
    manufacturing_date: {
        type: DataTypes.DATE,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('active', 'sold', 'expired', 'damaged', 'returned', 'disposed'),
        allowNull: false,
        defaultValue: 'active'
    },
    days_until_expiry: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    is_expired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    created_by_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    updated_by_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
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
    tableName: 'product_expiry_dates',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['product_id']
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['expiry_date']
        },
        {
            fields: ['store_id']
        },
        {
            fields: ['status']
        },
        {
            fields: ['batch_number']
        },
        {
            fields: ['is_expired']
        },
        {
            fields: ['days_until_expiry']
        },
        {
            fields: ['product_id', 'expiry_date']
        },
        {
            fields: ['store_id', 'status']
        },
        {
            fields: ['is_expired', 'status']
        }
    ]
});

// Product association
ProductExpiryDate.belongsTo(require('./product'), {
    foreignKey: 'product_id',
    as: 'product'
});

// Store association
ProductExpiryDate.belongsTo(require('./store'), {
    foreignKey: 'store_id',
    as: 'store'
});

// Currency association
ProductExpiryDate.belongsTo(require('./currency'), {
    foreignKey: 'currency_id',
    as: 'currency'
});

// Created by user association
ProductExpiryDate.belongsTo(require('./user'), {
    foreignKey: 'created_by_id',
    as: 'createdByUser'
});

// Updated by user association
ProductExpiryDate.belongsTo(require('./user'), {
    foreignKey: 'updated_by_id',
    as: 'updatedByUser'
});

module.exports = ProductExpiryDate; 