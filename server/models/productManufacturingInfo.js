'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProductManufacturingInfo extends Model {
    static associate(models) {
      // Define associations here
      ProductManufacturingInfo.belongsTo(models.Product, {
        foreignKey: 'product_id',
        as: 'product'
      });
      
      ProductManufacturingInfo.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'creator'
      });
      
      ProductManufacturingInfo.belongsTo(models.User, {
        foreignKey: 'updated_by',
        as: 'updater'
      });
    }
  }
  
  ProductManufacturingInfo.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },
    manufacturing_process: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    production_time_hours: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,

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
    sequelize,
    modelName: 'ProductManufacturingInfo',
    tableName: 'product_manufacturing_info',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true
  });
  
  return ProductManufacturingInfo;
}; 