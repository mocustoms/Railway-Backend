const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const StockAdjustment = sequelize.define('StockAdjustment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    reference_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      // unique: true removed - using composite unique index with companyId instead

    },
    adjustment_date: {
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
    adjustment_type: {
      type: DataTypes.ENUM('add', 'deduct'),
      allowNull: false
    },
    reason_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'adjustment_reasons',
        key: 'id'
      }
    },
    account_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    corresponding_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    document_type: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    document_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
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
      defaultValue: 1.000000
    },
    system_default_currency_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'currencies',
        key: 'id'
      }
    },
    exchange_rate_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'exchange_rates',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('draft', 'submitted', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'draft'
    },
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
    equivalent_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
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
    submitted_at: {
      type: DataTypes.DATE,
      allowNull: true
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
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    rejection_reason: {
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
    tableName: 'stock_adjustments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['reference_number', 'companyId'],
        name: 'stock_adjustments_reference_number_companyId_unique'
      },
      {
        fields: ['store_id']
        },
        {
            fields: ['companyId']
      },
      {
        fields: ['reason_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['adjustment_date']
      },
      {
        fields: ['created_by']
      }
    ]
  });

  // Define associations
  StockAdjustment.associate = function(models) {
    // Associations will be set up in associations.js
  };

  return StockAdjustment;
};