const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProductPriceCategory = sequelize.define('ProductPriceCategory', {
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
    price_category_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'price_categories',
            key: 'id'
        }
    },
    calculated_price: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,

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
    tableName: 'product_price_categories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});

module.exports = ProductPriceCategory; 