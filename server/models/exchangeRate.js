const { DataTypes, Model } = require('sequelize');
const sequelize = require('../../config/database');

class ExchangeRate extends Model {}

ExchangeRate.init({
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    from_currency_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'currencies',
            key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    to_currency_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'currencies',
            key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    rate: {
        type: DataTypes.DECIMAL(15, 6),
        allowNull: false,
        validate: {
            min: 0
        }
    },
    effective_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    created_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    },
    updated_by: {
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
    modelName: 'ExchangeRate',
    tableName: 'exchange_rates',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['from_currency_id', 'to_currency_id', 'effective_date']
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['from_currency_id']
        },
        {
            fields: ['to_currency_id']
        },
        {
            fields: ['effective_date']
        },
        {
            fields: ['is_active']
        }
    ]
});

module.exports = ExchangeRate; 