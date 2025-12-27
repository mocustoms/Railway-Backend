const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesInvoice = sequelize.define('SalesInvoice', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    invoice_ref_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      // unique: true removed - using composite unique index with companyId instead

    },
    invoice_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,

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
    sales_order_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_orders',
        key: 'id'
      },

    },
    proforma_invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'proforma_invoices',
        key: 'id'
      },

    },
    sales_agent_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_agents',
        key: 'id'
      },

    },
    financial_year_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'financial_years',
        key: 'id'
      },

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
    paid_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    balance_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    payment_status: {
      type: DataTypes.ENUM('unpaid', 'partial', 'paid', 'overpaid'),
      allowNull: false,
      defaultValue: 'unpaid',

    },
    status: {
      type: DataTypes.ENUM('draft', 'sent', 'approved', 'paid', 'partial_paid', 'overdue', 'cancelled', 'rejected'),
      allowNull: false,
      defaultValue: 'draft'
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
    approved_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },

    },
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,

    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true,

    },
    cancelled_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    cancelled_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    cancellation_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    rejected_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },

    },
    rejected_at: {
      type: DataTypes.DATE,
      allowNull: true,

    },
    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    discount_allowed_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      },

    },
    account_receivable_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      },

    },
    scheduled_type: {
      type: DataTypes.ENUM('not_scheduled', 'one_time', 'recurring'),
      allowNull: false,
      defaultValue: 'not_scheduled',

    },
    recurring_period: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'yearly'),
      allowNull: true,

    },
    scheduled_date: {
      type: DataTypes.DATE,
      allowNull: true,

    },
    recurring_day_of_week: {
      type: DataTypes.ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'),
      allowNull: true,

    },
    recurring_date: {
      type: DataTypes.INTEGER,
      allowNull: true,

      validate: {
        min: 1,
        max: 31
      }
    },
    recurring_month: {
      type: DataTypes.ENUM('january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'),
      allowNull: true,

    },
    start_time: {
      type: DataTypes.TIME,
      allowNull: true,

    },
    end_time: {
      type: DataTypes.TIME,
      allowNull: true,

    },
    parent_invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_invoices',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

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
    tableName: 'sales_invoices',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { 
        unique: true, 
        fields: ['invoice_ref_number', 'companyId'],
        name: 'sales_invoices_invoice_ref_number_companyId_unique'
      },
      {
        fields: ['companyId']
      },
      { fields: ['invoice_date'] },
      { fields: ['due_date'] },
      { fields: ['store_id'] },
      { fields: ['customer_id'] },
      { fields: ['status'] },
      { fields: ['payment_status'] },
      { fields: ['sales_order_id'] },
      { fields: ['proforma_invoice_id'] },
      { fields: ['financial_year_id'] },
      { fields: ['discount_allowed_account_id'] },
      { fields: ['account_receivable_id'] },
      { fields: ['created_by'] },
      { fields: ['created_at'] },
      { fields: ['parent_invoice_id'] }
    ]
  });

  return SalesInvoice;
};

