const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class Store extends Model {}

Store.init({
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            notEmpty: true
        }
    },
    store_type: {
        type: DataTypes.ENUM('pharmacy', 'retail_shop', 'restaurant', 'barber_shop', 'supermarket', 'clothing_store', 'electronics_store', 'hardware_store', 'jewelry_store', 'bookstore', 'other'),
        allowNull: false,
        defaultValue: 'retail_shop',
    },
    location: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            notEmpty: true
        }
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            notEmpty: true
        }
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isEmail: true
        }
    },
    address: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    // Currency relationship
    default_currency_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'currencies',
            key: 'id'
        },

    },
    // Price Category relationship
    default_price_category_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'price_categories',
            key: 'id'
        },

    },
    // GPS Coordinates
    latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
        validate: {
            min: -90,
            max: 90
        }
    },
    longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
        validate: {
            min: -180,
            max: 180
        }
    },
    // Store Settings for Future Use
    is_manufacturing: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,

    },
    can_receive_po: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,

    },
    can_issue_to_store: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,

    },
    can_receive_from_store: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,

    },
    can_sale_products: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,

    },
    is_storage_facility: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,

    },
    has_temperature_control: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,

    },
    temperature_min: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,

    },
    temperature_max: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,

    },
    // Additional flexible settings for future use
    settings: {
        type: DataTypes.JSONB,
        allowNull: true,

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
    sequelize,
    modelName: 'Store',
    tableName: 'stores',
    timestamps: true
});

module.exports = Store; 