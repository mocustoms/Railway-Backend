const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesOrderItem = sequelize.define('SalesOrderItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    sales_order_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'sales_orders',
        key: 'id',
        onDelete: 'CASCADE'
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
    quantity: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: false,
      defaultValue: 0.000
    },
    unit_price: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    discount_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    discount_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    tax_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    tax_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    price_tax_inclusive: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,

    },
    sales_tax_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'tax_codes',
        key: 'id'
      },

    },
    wht_tax_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'tax_codes',
        key: 'id'
      },

    },
    wht_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
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
    equivalent_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    amount_after_discount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    amount_after_wht: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    line_total: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    serial_numbers: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],

    },
    batch_number: {
      type: DataTypes.STRING(100),
      allowNull: true,

    },
    expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,

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
    financial_year_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'financial_years',
        key: 'id'
      },

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
    tableName: 'sales_order_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['sales_order_id'] },
      {
        fields: ['companyId']
      },
      { fields: ['product_id'] },
      { fields: ['created_by'] },
      { fields: ['sales_tax_id'] },
      { fields: ['wht_tax_id'] },
      { fields: ['currency_id'] },
      { fields: ['financial_year_id'] }
    ]
  });

  return SalesOrderItem;
};

