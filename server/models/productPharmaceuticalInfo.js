'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProductPharmaceuticalInfo extends Model {}
  ProductPharmaceuticalInfo.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false
    },

    max_dose: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    frequency: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    adjustments: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: true
    },
    updated_by: {
      type: DataTypes.UUID,
      allowNull: true
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
    modelName: 'ProductPharmaceuticalInfo',
    tableName: 'product_pharmaceutical_info',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true
  });
  return ProductPharmaceuticalInfo;
}; 