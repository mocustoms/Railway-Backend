const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProductStore = sequelize.define('ProductStore', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    product_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'products',
            key: 'id'
        }
    },
    store_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'stores',
            key: 'id'
        }
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },

    // Stock tracking fields
    quantity: {
        type: DataTypes.DECIMAL(15, 3),
        allowNull: false,
        defaultValue: 0,

    },
    min_quantity: {
        type: DataTypes.DECIMAL(15, 3),
        defaultValue: 0,

    },
    max_quantity: {
        type: DataTypes.DECIMAL(15, 3),
        allowNull: true,

    },
    reorder_point: {
        type: DataTypes.DECIMAL(15, 3),
        defaultValue: 0,

    },
    average_cost: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0,

    },
    last_updated: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,

    },
    // Assignment tracking
    assigned_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },

    },
    assigned_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,

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
    tableName: 'product_stores',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['product_id', 'store_id', 'companyId'],
            name: 'product_stores_product_id_store_id_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['product_id']
        },
        {
            fields: ['store_id']
        },
        {
            fields: ['is_active']
        }
    ]
});

// Define associations
ProductStore.associate = function(models) {
    ProductStore.belongsTo(models.Product, {
        foreignKey: 'product_id',
        as: 'product'
    });
    
    ProductStore.belongsTo(models.Store, {
        foreignKey: 'store_id',
        as: 'store'
    });
    
    ProductStore.belongsTo(models.User, {
        foreignKey: 'assigned_by',
        as: 'assignedBy'
    });
};

module.exports = ProductStore; 