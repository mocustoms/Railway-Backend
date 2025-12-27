const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const PriceCategory = sequelize.define('PriceCategory', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        // unique: true removed - using composite unique index with companyId instead

    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    price_change_type: {
        type: DataTypes.ENUM('increase', 'decrease'),
        allowNull: false,
        defaultValue: 'increase'
    },
    percentage_change: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.00,
        validate: {
            min: 0,
            max: 100
        }
    },
    scheduled_type: {
        type: DataTypes.ENUM('not_scheduled', 'one_time', 'recurring'),
        allowNull: false,
        defaultValue: 'not_scheduled'
    },
    recurring_period: {
        type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'yearly'),
        allowNull: true
    },
    scheduled_date: {
        type: DataTypes.DATE,
        allowNull: true
    },
    // Enhanced recurring scheduling fields
    recurring_day_of_week: {
        type: DataTypes.ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'),
        allowNull: true
    },
    recurring_date: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: 1,
            max: 31
        }
    },
    recurring_month: {
        type: DataTypes.ENUM('january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'),
        allowNull: true
    },
    start_time: {
        type: DataTypes.TIME,
        allowNull: true
    },
    end_time: {
        type: DataTypes.TIME,
        allowNull: true
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
    tableName: 'price_categories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'price_categories_code_companyId_unique'
        },
        {
            fields: ['companyId']
        }
    ]
});

module.exports = PriceCategory; 