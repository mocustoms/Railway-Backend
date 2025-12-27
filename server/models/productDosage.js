'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProductDosage extends Model {
    static associate(models) {
      ProductDosage.belongsTo(models.Product, {
        foreignKey: 'product_id',
        as: 'product'
      });
      ProductDosage.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'creator'
      });
      ProductDosage.belongsTo(models.User, {
        foreignKey: 'updated_by',
        as: 'updater'
      });
    }
  }
  
  ProductDosage.init({
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
      }
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: true,

    },
    max_dose: {
      type: DataTypes.STRING(255),
      allowNull: true,

    },
    frequency: {
      type: DataTypes.STRING(255),
      allowNull: true,

    },
    duration: {
      type: DataTypes.STRING(255),
      allowNull: true,

    },
    indication: {
      type: DataTypes.STRING(255),
      allowNull: true,

    },
    age_min: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,

    },
    age_max: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,

    },
    weight_min: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,

    },
    weight_max: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,

    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,

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
    modelName: 'ProductDosage',
    tableName: 'product_dosages',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        fields: ['product_id']
        },
        {
            fields: ['companyId']
      },
      {
        fields: ['age_min', 'age_max']
      },
      {
        fields: ['weight_min', 'weight_max']
      },
      {
        fields: ['sort_order']
      }
    ]
  });
  
  return ProductDosage;
}; 