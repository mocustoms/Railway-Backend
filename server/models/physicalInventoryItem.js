const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PhysicalInventoryItem = sequelize.define('PhysicalInventoryItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    physical_inventory_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'physical_inventories',
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
    
    // Stock quantities
    current_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0
    },
    counted_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0
    },
    
    // Adjustment quantities (calculated)
    adjustment_in_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0
    },
    adjustment_out_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0
    },
    
    // Adjustment reasons for this item
    adjustment_in_reason_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'adjustment_reasons',
        key: 'id'
      }
    },
    adjustment_out_reason_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'adjustment_reasons',
        key: 'id'
      }
    },
    
    // Cost and value
    unit_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    unit_average_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    new_stock: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0
    },
    total_value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    
    // Delta calculations
    delta_quantity: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0.0000
    },
    delta_value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    
    // Currency conversion
    exchange_rate: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: false,
      defaultValue: 1.000000,
      get() {
        const value = this.getDataValue('exchange_rate');
        if (value === null || value === undefined) {
          return 1.000000;
        }
        // Sequelize returns DECIMAL as string - clean it
        const str = String(value);
        // Remove multiple decimal points
        if (str.includes('.')) {
          const firstDotIndex = str.indexOf('.');
          const beforeDot = str.substring(0, firstDotIndex + 1);
          const afterDot = str.substring(firstDotIndex + 1).replace(/\./g, '');
          const cleaned = beforeDot + afterDot;
          return parseFloat(cleaned) || 1.000000;
        }
        return parseFloat(str) || 1.000000;
      },
      set(value) {
        // Clean value before setting
        if (value === null || value === undefined) {
          this.setDataValue('exchange_rate', 1.000000);
          return;
        }
        const str = String(value);
        // Remove multiple decimal points
        if (str.includes('.')) {
          const firstDotIndex = str.indexOf('.');
          const beforeDot = str.substring(0, firstDotIndex + 1);
          const afterDot = str.substring(firstDotIndex + 1).replace(/\./g, '');
          const cleaned = beforeDot + afterDot;
          this.setDataValue('exchange_rate', parseFloat(cleaned) || 1.000000);
        } else {
          this.setDataValue('exchange_rate', parseFloat(str) || 1.000000);
        }
      }
    },
    equivalent_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      get() {
        const value = this.getDataValue('equivalent_amount');
        if (value === null || value === undefined) {
          return 0.00;
        }
        // Sequelize returns DECIMAL as string - clean it
        const str = String(value);
        // Remove multiple decimal points
        if (str.includes('.')) {
          const firstDotIndex = str.indexOf('.');
          const beforeDot = str.substring(0, firstDotIndex + 1);
          const afterDot = str.substring(firstDotIndex + 1).replace(/\./g, '');
          const cleaned = beforeDot + afterDot;
          return parseFloat(cleaned) || 0.00;
        }
        return parseFloat(str) || 0.00;
      },
      set(value) {
        // Clean value before setting
        if (value === null || value === undefined) {
          this.setDataValue('equivalent_amount', 0.00);
          return;
        }
        const str = String(value);
        // Remove multiple decimal points
        if (str.includes('.')) {
          const firstDotIndex = str.indexOf('.');
          const beforeDot = str.substring(0, firstDotIndex + 1);
          const afterDot = str.substring(firstDotIndex + 1).replace(/\./g, '');
          const cleaned = beforeDot + afterDot;
          this.setDataValue('equivalent_amount', parseFloat(cleaned) || 0.00);
        } else {
          this.setDataValue('equivalent_amount', parseFloat(str) || 0.00);
        }
      }
    },
    
    // Tracking fields
    expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    batch_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    serial_numbers: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
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

    },
    
    // Timestamps
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'physical_inventory_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['physical_inventory_id']
      },
      {
        fields: ['product_id']
      },
      {
        fields: ['batch_number']
      },
      {
        fields: ['expiry_date']
      },
      {
        fields: ['companyId']
      }
    ]
  });

  // Define associations
  PhysicalInventoryItem.associate = (models) => {
    PhysicalInventoryItem.belongsTo(models.PhysicalInventory, {
      foreignKey: 'physical_inventory_id',
      as: 'physicalInventory'
    });
    
    PhysicalInventoryItem.belongsTo(models.Product, {
      foreignKey: 'product_id',
      as: 'product'
    });
    
    PhysicalInventoryItem.belongsTo(models.AdjustmentReason, {
      foreignKey: 'adjustment_in_reason_id',
      as: 'adjustmentInReason'
    });
    
    PhysicalInventoryItem.belongsTo(models.AdjustmentReason, {
      foreignKey: 'adjustment_out_reason_id',
      as: 'adjustmentOutReason'
    });
  };

  return PhysicalInventoryItem;
};
