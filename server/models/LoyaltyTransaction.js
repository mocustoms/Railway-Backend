const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LoyaltyTransaction = sequelize.define('LoyaltyTransaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    loyalty_card_id: {
      type: DataTypes.UUID,
      allowNull: true, // Made nullable since loyalty_cards table may not exist
      references: {
        model: 'loyalty_cards',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',

    },
    transaction_type: {
      type: DataTypes.ENUM('earn', 'redeem', 'expire', 'adjust', 'bonus'),
      allowNull: false
    },
    points_amount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    transaction_reference: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    // order_id: {
    //   type: DataTypes.UUID,
    //   allowNull: true,
    //   references: {
    //     model: 'orders',
    //     key: 'id'
    //   },
    //   onUpdate: 'CASCADE',
    //   onDelete: 'SET NULL',

    // },
    // Sales transaction links
    sales_invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_invoices',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    sales_order_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_orders',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    sales_transaction_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_transactions',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    // Entity relationships
    customer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'customers',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    store_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'stores',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    loyalty_config_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'loyalty_card_configs',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    // Financial tracking
    financial_year_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'financial_years',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    transaction_ref_number: {
      type: DataTypes.STRING(50),
      allowNull: true,

    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: null,

    },
    redemption_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: null,

    },
    currency_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'currencies',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    exchange_rate: {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: true,
      defaultValue: 1.000000,

    },
    // Status and notes
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'cancelled', 'failed'),
      allowNull: true,
      defaultValue: 'completed',

    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    points_balance_before: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    points_balance_after: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    tier_before: {
      type: DataTypes.ENUM('bronze', 'silver', 'gold', 'platinum'),
      allowNull: true
    },
    tier_after: {
      type: DataTypes.ENUM('bronze', 'silver', 'gold', 'platinum'),
      allowNull: true
    },
    transaction_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    expiry_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_expired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    // Audit fields
    updated_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    updated_at: {
      type: DataTypes.DATE,
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
    tableName: 'loyalty_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['loyalty_card_id']
        },
        {
            fields: ['companyId']
      },
      {
        fields: ['transaction_type']
      },
      {
        fields: ['transaction_date']
      },
      // {
      //   fields: ['order_id']
      // },
      {
        fields: ['is_expired']
      },
      {
        fields: ['sales_invoice_id']
      },
      {
        fields: ['sales_order_id']
      },
      {
        fields: ['sales_transaction_id']
      },
      {
        fields: ['customer_id']
      },
      {
        fields: ['store_id']
      },
      {
        fields: ['financial_year_id']
      },
      {
        fields: ['transaction_ref_number']
      },
      {
        fields: ['status']
      },
      {
        unique: true,
        fields: ['transaction_ref_number', 'companyId'],
        name: 'loyalty_transactions_transaction_ref_number_companyId_unique'
      }
    ]
  });

  return LoyaltyTransaction;
};
