const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const PriceHistory = sequelize.define('PriceHistory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // Entity identification
  entity_type: {
    type: DataTypes.STRING(50),
    allowNull: false,

  },
  entity_id: {
    type: DataTypes.UUID,
    allowNull: false,

  },
  entity_code: {
    type: DataTypes.STRING(50),
    allowNull: true,

  },
  entity_name: {
    type: DataTypes.STRING(255),
    allowNull: true,

  },
  
  // Module identification
  module_name: {
    type: DataTypes.STRING(100),
    allowNull: false,

  },
  transaction_type_id: {
    type: DataTypes.UUID,
    allowNull: true,

  },
  transaction_type_name: {
    type: DataTypes.STRING(100),
    allowNull: true,

  },
  
  // Price information
  old_selling_price: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,

  },
  new_selling_price: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,

  },
  
  // Costing method
  costing_method_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  
  // Change reason
  price_change_reason_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  
  // Additional context
  quantity: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: true,

  },
  unit: {
    type: DataTypes.STRING(20),
    allowNull: true,

  },
  currency_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  exchange_rate: {
    type: DataTypes.DECIMAL(15, 6),
    allowNull: true,
    defaultValue: 1.0,

  },
  exchange_rate_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'exchange_rates',
      key: 'id'
    },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',

  },
  
  // Metadata
  reference_number: {
    type: DataTypes.STRING(50),
    allowNull: true,

  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,

  },
  
  // Timestamps
  change_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,

  },
  transaction_date: {
    type: DataTypes.DATE,
    allowNull: true,

  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: true
  },
  conversion_notes: {
    type: DataTypes.TEXT,
    allowNull: true,

  },
  system_currency_id: {
    type: DataTypes.UUID,
    allowNull: true,

  },
  product_average_cost_old: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,

  },
  product_average_cost_new: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,

  },
  user_unit_cost_old: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,

  },
  user_unit_cost_new: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,

  },
  equivalent_amount_old: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,

  },
  equivalent_amount_new: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,

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
  tableName: 'price_history',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false, // No updated_at field for price history
  indexes: [
    {
      fields: ['entity_type', 'entity_id']
    },
    {
      fields: ['companyId']
    },
    {
      fields: ['module_name'],
      name: 'price_history_module_idx'
    },
    {
      fields: ['change_date']
    },
    {
      fields: ['transaction_date']
    },
    {
      fields: ['entity_type', 'entity_id', 'change_date']
    }
  ]
});

module.exports = PriceHistory; 