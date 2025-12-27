const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProductColor = sequelize.define('ProductColor', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 20]
        },

    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        }
    },
    hex_code: {
        type: DataTypes.STRING(7),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [7, 7],
            is: /^#[0-9A-F]{6}$/i
        }
    },
    description: {
        type: DataTypes.TEXT,
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
    tableName: 'product_colors',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'product_colors_code_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['name']
        },
        {
            fields: ['hex_code']
        },
        {
            fields: ['is_active']
        }
    ]
});

module.exports = ProductColor; 