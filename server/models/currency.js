const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class Currency extends Model {}

Currency.init({
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    code: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [1, 50], // Allow longer codes for auto-generated codes
            notEmpty: true
        },

    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [1, 100]
        }
    },
    symbol: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [1, 10]
        }
    },
    country: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            len: [0, 100]
        }
    },
    flag: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            len: [0, 10]
        }
    },
    is_default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    created_by: {
        type: DataTypes.UUID,
        allowNull: true
    },
    updated_by: {
        type: DataTypes.UUID,
        allowNull: true
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
    modelName: 'Currency',
    tableName: 'currencies',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'currencies_code_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['is_active']
        },
        {
            fields: ['is_default']
        }
    ],
    hooks: {
        beforeCreate: async (currency) => {
            // If this is the first currency for this company, make it default
            const count = await Currency.count({
                where: { companyId: currency.companyId }
            });
            if (count === 0) {
                currency.is_default = true;
            }
        },
        beforeUpdate: async (currency) => {
            // If setting as default, ensure only one default exists per company
            if (currency.changed('is_default') && currency.is_default) {
                await Currency.update(
                    { is_default: false },
                    { 
                        where: { 
                            is_default: true,
                            companyId: currency.companyId,
                            id: { [sequelize.Sequelize.Op.ne]: currency.id }
                        }
                    }
                );
            }
            
            // Prevent deactivating the default currency
            if (currency.changed('is_active') && !currency.is_active && currency.is_default) {
                throw new Error('Cannot deactivate the default currency. Please set another currency as default first.');
            }
        },
        beforeDestroy: async (currency) => {
            // Prevent deleting the default currency
            if (currency.is_default) {
                throw new Error('Cannot delete the default currency. Please set another currency as default first.');
            }
            
            // Check if currency is in use (within same company)
            const { ExchangeRate, Store } = require('./index');
            
            const exchangeRateCount = await ExchangeRate.count({
                where: {
                    companyId: currency.companyId,
                    [sequelize.Sequelize.Op.or]: [
                        { from_currency_id: currency.id },
                        { to_currency_id: currency.id }
                    ]
                }
            });
            
            const storeCount = await Store.count({
                where: { 
                    companyId: currency.companyId,
                    default_currency_id: currency.id 
                }
            });
            
            if (exchangeRateCount > 0 || storeCount > 0) {
                throw new Error('Cannot delete currency that is currently in use.');
            }
        }
    }
});

module.exports = Currency; 