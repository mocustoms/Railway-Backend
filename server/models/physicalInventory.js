const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PhysicalInventory = sequelize.define('PhysicalInventory', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    reference_number: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    inventory_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    store_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      }
    },
    
    // Dual adjustment reasons (inspired by Stock Adjustment)
    inventory_in_reason_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'adjustment_reasons',
        key: 'id'
      }
    },
    inventory_out_reason_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'adjustment_reasons',
        key: 'id'
      }
    },
    
    // Dual accounts (inspired by Stock Adjustment)
    inventory_in_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    inventory_in_corresponding_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    inventory_out_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    inventory_out_corresponding_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    
    // Currency and exchange rate
    currency_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'currencies',
        key: 'id'
      }
    },
    exchange_rate: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
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
    
    // Status and workflow (inspired by Stock Adjustment)
    status: {
      type: DataTypes.ENUM('draft', 'submitted', 'approved', 'rejected', 'returned_for_correction'),
      allowNull: false,
      defaultValue: 'draft'
    },
    
    // Totals
    total_items: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    total_value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    
    // User tracking (inspired by Stock Adjustment)
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
    submitted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    approved_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
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
    },
    submitted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // Additional fields
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    return_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    returned_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    returned_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // Variance acceptance fields
    variance_accepted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    variance_accepted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    total_delta_value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    positive_delta_value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    negative_delta_value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    variance_notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    // Approval fields
    approval_notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    inventory_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    gain_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    loss_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
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
    tableName: 'physical_inventories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['reference_number']
      },
      {
        fields: ['inventory_date']
      },
      {
        fields: ['store_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['created_by']
      },
      {
        fields: ['inventory_in_reason_id']
      },
      {
        fields: ['inventory_out_reason_id']
      },
      {
        fields: ['companyId']
      }
    ]
  });

  // Define associations
  PhysicalInventory.associate = (models) => {
    // Store association
    PhysicalInventory.belongsTo(models.Store, { 
      as: 'store', 
      foreignKey: 'store_id' 
    });
    
    // Adjustment reasons associations
    PhysicalInventory.belongsTo(models.AdjustmentReason, { 
      as: 'inventoryInReason', 
      foreignKey: 'inventory_in_reason_id' 
    });
    PhysicalInventory.belongsTo(models.AdjustmentReason, { 
      as: 'inventoryOutReason', 
      foreignKey: 'inventory_out_reason_id' 
    });
    
    // Account associations
    PhysicalInventory.belongsTo(models.Account, { 
      as: 'inventoryInAccount', 
      foreignKey: 'inventory_in_account_id' 
    });
    PhysicalInventory.belongsTo(models.Account, { 
      as: 'inventoryInCorrespondingAccount', 
      foreignKey: 'inventory_in_corresponding_account_id' 
    });
    PhysicalInventory.belongsTo(models.Account, { 
      as: 'inventoryOutAccount', 
      foreignKey: 'inventory_out_account_id' 
    });
    PhysicalInventory.belongsTo(models.Account, { 
      as: 'inventoryOutCorrespondingAccount', 
      foreignKey: 'inventory_out_corresponding_account_id' 
    });
    
    // Currency association
    PhysicalInventory.belongsTo(models.Currency, { 
      as: 'currency', 
      foreignKey: 'currency_id' 
    });
    
    // User associations
    PhysicalInventory.belongsTo(models.User, { 
      as: 'creator', 
      foreignKey: 'created_by' 
    });
    PhysicalInventory.belongsTo(models.User, { 
      as: 'updater', 
      foreignKey: 'updated_by' 
    });
    PhysicalInventory.belongsTo(models.User, { 
      as: 'submitter', 
      foreignKey: 'submitted_by' 
    });
    PhysicalInventory.belongsTo(models.User, { 
      as: 'approver', 
      foreignKey: 'approved_by' 
    });
    PhysicalInventory.belongsTo(models.User, { 
      as: 'returner', 
      foreignKey: 'returned_by' 
    });
    PhysicalInventory.belongsTo(models.User, { 
      as: 'varianceAcceptor', 
      foreignKey: 'variance_accepted_by' 
    });
    
    // Additional account associations for approval
    PhysicalInventory.belongsTo(models.Account, { 
      as: 'inventoryAccount', 
      foreignKey: 'inventory_account_id' 
    });
    PhysicalInventory.belongsTo(models.Account, { 
      as: 'gainAccount', 
      foreignKey: 'gain_account_id' 
    });
    PhysicalInventory.belongsTo(models.Account, { 
      as: 'lossAccount', 
      foreignKey: 'loss_account_id' 
    });
    
    // Items association
    PhysicalInventory.hasMany(models.PhysicalInventoryItem, { 
      as: 'items', 
      foreignKey: 'physical_inventory_id',
      onDelete: 'CASCADE'
    });
  };

  return PhysicalInventory;
};
