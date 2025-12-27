const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProductStoreLocation = sequelize.define('ProductStoreLocation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    store_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'stores',
            key: 'id'
        }
    },
    location_code: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        }
    },
    location_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        }
    },
    location_capacity: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: 0
        },

    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,

    },
    min_quantity: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,

    },
    max_quantity: {
        type: DataTypes.INTEGER,
        allowNull: true,

    },
    reorder_point: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,

    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,

    },
    packaging_type: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: [],

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
    tableName: 'product_store_locations',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['store_id', 'location_name'],
            name: 'store_location_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['store_id'],
            name: 'product_store_locations_store_id_idx'
        },
        {
            fields: ['is_active']
        }
    ]
});

module.exports = ProductStoreLocation; 