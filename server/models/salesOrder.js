const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesOrder = sequelize.define('SalesOrder', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    sales_order_ref_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      // unique: true removed - using composite unique index with companyId instead

    },
    sales_order_date: {
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
    customer_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'customers',
        key: 'id'
      }
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
    price_category_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'price_categories',
        key: 'id'
      }
    },
    financial_year_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'financial_years',
        key: 'id'
      },

    },
    subtotal: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    tax_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    discount_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    total_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    equivalent_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    amount_after_discount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    total_wht_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    amount_after_wht: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    status: {
      type: DataTypes.ENUM('draft', 'sent', 'accepted', 'rejected', 'expired', 'delivered'),
      allowNull: false,
      defaultValue: 'draft'
    },
    is_converted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,

    },
    valid_until: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    delivery_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,

    },
    shipping_address: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    terms_conditions: {
      type: DataTypes.TEXT,
      allowNull: true
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
    sent_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    accepted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    accepted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    rejected_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    rejected_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    fulfilled_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    fulfilled_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'companyId',
      references: {
       model: 'company',
        key: 'id'
      },

    }
  }, {
    tableName: 'sales_orders',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { 
        unique: true, 
        fields: ['sales_order_ref_number', 'companyId'],
        name: 'sales_orders_sales_order_ref_number_companyId_unique'
      },
      {
        fields: ['companyId']
      },
      { fields: ['sales_order_date'] },
      { fields: ['store_id'] },
      { fields: ['customer_id'] },
      { fields: ['status'] },
      { fields: ['is_converted'] },
      { fields: ['financial_year_id'] },
      { fields: ['created_by'] },
      { fields: ['created_at'] }
    ]
  });

  return SalesOrder;
};

