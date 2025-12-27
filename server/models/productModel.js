const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProductModel = sequelize.define('ProductModel', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 50]
        },

    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        }
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
    brand: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    model_number: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    logo: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    specifications: {
        type: DataTypes.JSONB,
        allowNull: true
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
    tableName: 'product_models',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'product_models_code_companyId_unique'
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
            fields: ['brand']
        },
        {
            fields: ['is_active']
        }
    ]
});

module.exports = ProductModel; 