const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesTransaction = sequelize.define('SalesTransaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    transaction_ref_number: {
      type: DataTypes.STRING(50),
      allowNull: false,

    },
    transaction_type: {
      type: DataTypes.ENUM('invoice', 'order', 'return', 'refund', 'credit_note', 'debit_note'),
      allowNull: false,

    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'companyId',
      references: {
       model: 'company',
        key: 'id'
      },

    },
    // Source References
    source_invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_invoices',
        key: 'id'
      },

    },
    source_order_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_orders',
        key: 'id'
      },

    },
    source_transaction_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_transactions',
        key: 'id'
      },

    },
    parent_transaction_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sales_transactions',
        key: 'id'
      },

    },
    // Transaction Details
    transaction_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,

    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,

    },
    valid_until: {
      type: DataTypes.DATEONLY,
      allowNull: true,

    },
    delivery_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,

    },
    // Entity Relationships
    store_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      },

    },
    customer_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'customers',
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
      allowNull: false,
      references: {
        model: 'financial_years',
        key: 'id'
      },

    },
    // Product Attributes (from primary product in transaction)
    product_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'products',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    product_type: {
      type: DataTypes.ENUM('resale', 'raw_materials', 'manufactured', 'services', 'pharmaceuticals'),
      allowNull: true,

    },
    product_category_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'product_categories',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    brand_name_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'product_brand_names',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    manufacturer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'product_manufacturers',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    model_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'product_models',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    color_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'product_colors',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    packaging_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'packaging',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    price_category_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'price_categories',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    store_location_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'product_store_locations',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',

    },
    // Financial Information
    subtotal: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    discount_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    tax_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    total_wht_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    amount_after_discount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    amount_after_wht: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    total_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    paid_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    balance_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    equivalent_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,

    },
    // Currency & Exchange
    currency_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'currencies',
        key: 'id'
      },

    },
    exchange_rate: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      defaultValue: 1.000000,

    },
    exchange_rate_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'exchange_rates',
        key: 'id'
      },

    },
    system_default_currency_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'currencies',
        key: 'id'
      },

    },
    // Status & Lifecycle
    status: {
      type: DataTypes.ENUM(
        'draft', 
        'sent', 
        'approved', 
        'paid', 
        'partial_paid', 
        'overdue', 
        'cancelled', 
        'rejected', 
        'accepted', 
        'expired', 
        'delivered'
      ),
      allowNull: false,
      defaultValue: 'draft',

    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,

    },
    is_cancelled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,

    },
    // Additional Information
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    terms_conditions: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    shipping_address: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true,

    },
    // Receipt Information
    receipt_invoice_number: {
      type: DataTypes.STRING(50),
      allowNull: true,

    },
    receipt_number: {
      type: DataTypes.STRING(50),
      allowNull: true,

    },
    // Audit Trail
    created_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },

    },
    updated_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },

    },
    sent_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },

    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true,

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
    cancelled_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },

    },
    cancelled_at: {
      type: DataTypes.DATE,
      allowNull: true,

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

    }
  }, {
    tableName: 'sales_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['companyId'] },
      { fields: ['transaction_type'] },
      { fields: ['transaction_date'] },
      { fields: ['store_id'] },
      { fields: ['customer_id'] },
      { fields: ['status'] },
      { fields: ['source_invoice_id'] },
      { fields: ['source_order_id'] },
      { fields: ['source_transaction_id'] },
      { fields: ['parent_transaction_id'] },
      { fields: ['sales_agent_id'] },
      { fields: ['financial_year_id'] },
      { fields: ['currency_id'] },
      { fields: ['created_by'] },
      { fields: ['updated_by'] },
      { fields: ['sent_by'] },
      { fields: ['approved_by'] },
      { fields: ['cancelled_by'] },
      { fields: ['rejected_by'] },
      { fields: ['receipt_invoice_number'] },
      { fields: ['receipt_number'] },
      // Product attribute indexes
      { fields: ['product_type'] },
      { fields: ['product_category_id'] },
      { fields: ['brand_name_id'] },
      { fields: ['manufacturer_id'] },
      { fields: ['model_id'] },
      { fields: ['color_id'] },
      { fields: ['packaging_id'] },
      { fields: ['price_category_id'] },
      { fields: ['store_location_id'] },
      // Composite indexes
      { fields: ['companyId', 'transaction_date'] },
      { fields: ['companyId', 'status'] },
      { fields: ['companyId', 'store_id', 'transaction_date'] },
      // Unique constraints
      { 
        fields: ['transaction_ref_number', 'companyId'],
        unique: true
      },
      { 
        fields: ['receipt_number', 'companyId'],
        unique: true
      }
    ]
  });

  return SalesTransaction;
};

