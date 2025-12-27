const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ReceiptItem = sequelize.define('ReceiptItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    receiptId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'receipt_id',
      references: {
        model: 'receipts',
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',

    },
    salesInvoiceId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'sales_invoice_id',
      references: {
        model: 'sales_invoices',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',

    },
    salesInvoiceItemId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'sales_invoice_item_id',
      references: {
        model: 'sales_invoice_items',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',

    },
    salesAgentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'sales_agent_id',
      references: {
        model: 'sales_agents',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    paymentAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      field: 'payment_amount',

    },
    // Currency Conversion Fields
    currencyId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'currency_id',
      references: {
        model: 'currencies',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',

    },
    exchangeRate: {
      type: DataTypes.DECIMAL(15, 6),
      allowNull: false,
      defaultValue: 1.000000,
      field: 'exchange_rate',

    },
    exchangeRateId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'exchange_rate_id',
      references: {
        model: 'exchange_rates',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    systemDefaultCurrencyId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'system_default_currency_id',
      references: {
        model: 'currencies',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',

    },
    equivalentAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      field: 'equivalent_amount',

    },
    itemTotal: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      field: 'item_total',

    },
    itemRemaining: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      field: 'item_remaining',

    },
    financialYearId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'financial_year_id',
      references: {
        model: 'financial_years',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',

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
    tableName: 'receipt_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['receipt_id'] },
      { fields: ['sales_invoice_id'] },
      { fields: ['sales_invoice_item_id'] },
      { fields: ['sales_agent_id'] },
      { fields: ['financial_year_id'] },
      { fields: ['currency_id'] },
      { fields: ['system_default_currency_id'] },
      { fields: ['companyId'] }
    ]
  });

  return ReceiptItem;
};

