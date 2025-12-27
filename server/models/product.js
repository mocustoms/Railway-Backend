const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Product = sequelize.define('Product', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    product_type: {
        type: DataTypes.ENUM('resale', 'raw_materials', 'manufactured', 'services', 'pharmaceuticals'),
        allowNull: true
    },
    code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 50]
        },

    },
    barcode: {
        type: DataTypes.STRING(100),
        allowNull: true,

    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        }
    },
    part_number: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    image: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    category_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_categories',
            key: 'id'
        }
    },
    brand_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_brand_names',
            key: 'id'
        }
    },
    manufacturer_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_manufacturers',
            key: 'id'
        }
    },
    model_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_models',
            key: 'id'
        }
    },
    store_location_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_store_locations',
            key: 'id'
        }
    },
    unit_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'packaging',
            key: 'id'
        }
    },
    cogs_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    income_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    asset_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    average_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true
    },
    selling_price: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true
    },

    purchases_tax_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'tax_codes',
            key: 'id'
        }
    },
    sales_tax_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'tax_codes',
            key: 'id'
        }
    },
    default_packaging_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'packaging',
            key: 'id'
        }
    },
    default_quantity: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    price_tax_inclusive: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    expiry_notification_days: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    track_serial_number: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
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
    color_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_colors',
            key: 'id'
        }
    },
    min_quantity: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,

    },
    max_quantity: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,

    },
    reorder_point: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,

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
    tableName: 'products',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'products_code_companyId_unique'
        },
        {
            unique: true,
            fields: ['barcode', 'companyId'],
            name: 'products_barcode_companyId_unique',
            where: {
                barcode: { [sequelize.Sequelize.Op.ne]: null }
            }
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['name']
        },
        {
            fields: ['category_id']
        },
        {
            fields: ['model_id']
        },
        {
            fields: ['is_active']
        },
        {
            fields: ['product_type']
        }
    ]
});

module.exports = Product; 