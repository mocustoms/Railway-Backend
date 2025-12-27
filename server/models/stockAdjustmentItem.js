const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const StockAdjustmentItem = sequelize.define('StockAdjustmentItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    stock_adjustment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'stock_adjustments',
        key: 'id'
      }
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id'
      }
    },
    current_stock: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0
    },
    adjusted_stock: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false
    },
    quantity_change: {
      type: DataTypes.VIRTUAL,
      get() {
        return parseFloat(this.adjusted_stock) - parseFloat(this.current_stock);
      }
    },
    user_unit_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false
    },
    total_value: {
      type: DataTypes.VIRTUAL,
      get() {
        return parseFloat(this.adjusted_stock) * parseFloat(this.user_unit_cost);
      }
    },
    serial_numbers: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
    },
    expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    batch_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    new_stock: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: true,
      defaultValue: 0,

    },
    notes: {
      type: DataTypes.TEXT,
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
    tableName: 'stock_adjustment_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['stock_adjustment_id']
        },
        {
            fields: ['companyId']
      },
      {
        fields: ['product_id']
      }
    ]
  });

  // Define associations
  StockAdjustmentItem.associate = function(models) {
    // Associations will be set up in associations.js
  };

  return StockAdjustmentItem;
};