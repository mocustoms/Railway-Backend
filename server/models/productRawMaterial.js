'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProductRawMaterial extends Model {
    static associate(models) {
      // Define associations here
      ProductRawMaterial.belongsTo(models.Product, {
        foreignKey: 'manufactured_product_id',
        as: 'manufacturedProduct'
      });
      
      ProductRawMaterial.belongsTo(models.Product, {
        foreignKey: 'raw_material_id',
        as: 'rawMaterial'
      });
      
      ProductRawMaterial.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'creator'
      });
      
      ProductRawMaterial.belongsTo(models.User, {
        foreignKey: 'updated_by',
        as: 'updater'
      });
    }
  }
  
  ProductRawMaterial.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    manufactured_product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',

    },
    raw_material_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',

    },
    quantity_per_unit: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 1.0,

    },
    unit: {
      type: DataTypes.STRING(50),
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
    modelName: 'ProductRawMaterial',
    tableName: 'product_raw_materials',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['manufactured_product_id', 'raw_material_id'],
        name: 'unique_product_raw_material'
      },
      {
        fields: ['companyId']
      }
    ]
  });
  
  return ProductRawMaterial;
}; 