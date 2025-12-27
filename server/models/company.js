const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class Company extends Model {}

Company.init({
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    code: {
        type: DataTypes.STRING(10),
        allowNull: true,
    },
    address: {
        type: DataTypes.STRING,
        allowNull: false
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false
    },
    fax: {
        type: DataTypes.STRING,
        allowNull: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false
    },
    website: {
        type: DataTypes.STRING,
        allowNull: true
    },
    tin: {
        type: DataTypes.STRING,
        allowNull: true
    },
    vrn: {
        type: DataTypes.STRING,
        allowNull: true
    },
    businessRegistrationNumber: {
        type: DataTypes.STRING,
        allowNull: true,

    },
    businessType: {
        type: DataTypes.STRING,
        allowNull: true,

    },
    industry: {
        type: DataTypes.STRING,
        allowNull: true,

    },
    country: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'Tanzania'
    },
    region: {
        type: DataTypes.STRING,
        allowNull: true
    },
    timezone: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'Africa/Dar_es_Salaam'
    },
    defaultCurrencyId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'currencies',
            key: 'id'
        },

    },
    logo: {
        type: DataTypes.STRING,
        allowNull: true,

    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,

    },
    costingMethod: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'costing_methods',
            key: 'id'
        },

    },
    efdSettings: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    subscriptionStatus: {
        type: DataTypes.ENUM('trial', 'active', 'suspended', 'cancelled'),
        allowNull: false,
        defaultValue: 'trial',
    },
    subscriptionPlan: {
        type: DataTypes.STRING(50),
        allowNull: true,

    },
    trialEndsAt: {
        type: DataTypes.DATE,
        allowNull: true,

    },
    subscriptionStartsAt: {
        type: DataTypes.DATE,
        allowNull: true,

    },
    subscriptionEndsAt: {
        type: DataTypes.DATE,
        allowNull: true,

    },
    maxUsers: {
        type: DataTypes.INTEGER,
        allowNull: true,

    },
    maxStores: {
        type: DataTypes.INTEGER,
        allowNull: true,

    }
}, {
    sequelize,
    modelName: 'Company',
    tableName: 'company',
    timestamps: true
});

// Define associations
Company.associate = (models) => {
    Company.belongsTo(models.Currency, {
        foreignKey: 'defaultCurrencyId',
        as: 'defaultCurrency'
    });
    
    Company.belongsTo(models.CostingMethod, {
        foreignKey: 'costingMethod',
        as: 'costingMethodDetails'
    });
};

module.exports = Company; 