const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Transaction = sequelize.define('Transaction', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    financial_year_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'financial_years',
            key: 'id'
        },

    },
    financial_year_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    system_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,

    },
    transaction_date: {
        type: DataTypes.DATE,
        allowNull: false,

    },
    reference_number: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    store_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'stores',
            key: 'id'
        },

    },
    store_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 50]
        },

    },
    product_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'products',
            key: 'id'
        },

    },
    category_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_categories',
            key: 'id'
        },

    },
    packaging_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'packaging',
            key: 'id'
        },

    },
    brand_name_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_brand_names',
            key: 'id'
        },

    },
    manufacturer_name_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_manufacturers',
            key: 'id'
        },

    },
    product_model_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'product_models',
            key: 'id'
        },

    },
    price_category_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'price_categories',
            key: 'id'
        },

    },
    transaction_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 50]
        },

    },
    transaction_type_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    created_by_code: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },

    },
    created_by_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        },

    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,

    },
    supplier_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'supplier',
            key: 'id'
        },

    },
    supplier_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
            len: [0, 255]
        },

    },
    packaging_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        validate: {
            len: [0, 50]
        },

    },
    packaging_pieces: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: 0
        },

    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'customers',
            key: 'id'
        },

    },
    default_currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 10]
        },

    },
    exchange_rate: {
        type: DataTypes.DECIMAL(15, 6),
        allowNull: false,
        defaultValue: 1.000000,
        validate: {
            min: 0
        },

    },
    transaction_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        validate: {
            min: 0
        },

    },
    equivalent_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        validate: {
            min: 0
        },

    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },

    },
    username: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        },

    },
    quantity_in: {
        type: DataTypes.DECIMAL(15, 3),
        allowNull: false,
        defaultValue: 0.000,
        validate: {
            min: 0
        },

    },
    quantity_out: {
        type: DataTypes.DECIMAL(15, 3),
        allowNull: false,
        defaultValue: 0.000,
        validate: {
            min: 0
        },

    },
    expiry_date: {
        type: DataTypes.DATE,
        allowNull: true,

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
    tableName: 'transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['financial_year_id']
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['transaction_date']
        },
        {
            fields: ['reference_number']
        },
        {
            fields: ['store_id']
        },
        {
            fields: ['product_id']
        },
        {
            fields: ['transaction_type']
        },
        {
            fields: ['created_by_code']
        },
        {
            fields: ['supplier_id']
        },
        {
            fields: ['customer_id']
        },
        {
            fields: ['account_id']
        },
        {
            fields: ['expiry_date']
        },
        {
            fields: ['financial_year_id', 'transaction_date']
        },
        {
            fields: ['store_id', 'transaction_date']
        },
        {
            fields: ['product_id', 'transaction_date']
        },
        {
            fields: ['transaction_type', 'transaction_date']
        },
        {
            fields: ['store_id', 'product_id']
        },
        {
            fields: ['financial_year_id', 'store_id']
        }
    ]
});

// Define associations
Transaction.associate = (models) => {
    Transaction.belongsTo(models.FinancialYear, {
        foreignKey: 'financial_year_id',
        as: 'financialYear'
    });
    
    Transaction.belongsTo(models.Store, {
        foreignKey: 'store_id',
        as: 'store'
    });
    
    Transaction.belongsTo(models.Product, {
        foreignKey: 'product_id',
        as: 'product'
    });
    
    Transaction.belongsTo(models.ProductCategory, {
        foreignKey: 'category_id',
        as: 'category'
    });
    
    Transaction.belongsTo(models.Packaging, {
        foreignKey: 'packaging_id',
        as: 'packaging'
    });
    
    Transaction.belongsTo(models.ProductBrandName, {
        foreignKey: 'brand_name_id',
        as: 'brandName'
    });
    
    Transaction.belongsTo(models.ProductManufacturer, {
        foreignKey: 'manufacturer_name_id',
        as: 'manufacturer'
    });
    
    Transaction.belongsTo(models.ProductModel, {
        foreignKey: 'product_model_id',
        as: 'productModel'
    });
    
    Transaction.belongsTo(models.PriceCategory, {
        foreignKey: 'price_category_id',
        as: 'priceCategory'
    });
    
    Transaction.belongsTo(models.User, {
        foreignKey: 'created_by_code',
        as: 'createdByUser'
    });
    
    Transaction.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user'
    });
    
    Transaction.belongsTo(models.Account, {
        foreignKey: 'account_id',
        as: 'account'
    });
    
    // Note: These associations depend on whether suppliers and customers tables exist
    // Transaction.belongsTo(models.Supplier, {
    //     foreignKey: 'supplier_id',
    //     as: 'supplier'
    // });
    
    // Transaction.belongsTo(models.Customer, {
    //     foreignKey: 'customer_id',
    //     as: 'customer'
    // });
};

module.exports = Transaction; 