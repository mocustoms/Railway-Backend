const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Receipt = sequelize.define('Receipt', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    receiptReferenceNumber: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'receipt_reference_number',

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
      onUpdate: 'CASCADE'
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'customer_id',
      references: {
        model: 'customers',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
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
    // Payment Method Fields
    paymentTypeId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'payment_type_id',
      references: {
        model: 'payment_types',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    useCustomerDeposit: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'use_customer_deposit',

    },
    depositAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,
      field: 'deposit_amount',

    },
    useLoyaltyPoints: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'use_loyalty_points',

    },
    loyaltyPointsAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,
      field: 'loyalty_points_amount',

    },
    loyaltyPointsValue: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,
      field: 'loyalty_points_value',

    },
    chequeNumber: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'cheque_number',

    },
    bankDetailId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'bank_detail_id',
      references: {
        model: 'bank_details',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    },
    branch: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'branch',

    },
    // Account References
    receivableAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'receivable_account_id',
      references: {
        model: 'accounts',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',

    },
    assetAccountId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'asset_account_id',
      references: {
        model: 'accounts',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    liabilityAccountId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'liability_account_id',
      references: {
        model: 'accounts',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    transactionDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'transaction_date',

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
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'description',

    },
    status: {
      type: DataTypes.ENUM('active', 'reversed', 'cancelled'),
      allowNull: false,
      defaultValue: 'active',
      field: 'status',

    },
    reversedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'reversed_at',

    },
    reversedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'reversed_by',
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    reversalReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'reversal_reason',

    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'created_by',
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    },
    updatedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'updated_by',
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
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
    tableName: 'receipts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['receipt_reference_number', 'companyId'],
        name: 'receipts_receipt_reference_number_companyId_unique'
      },
      { fields: ['sales_invoice_id'] },
      { fields: ['receipt_reference_number'] },
      { fields: ['customer_id'] },
      { fields: ['sales_agent_id'] },
      { fields: ['transaction_date'] },
      { fields: ['financial_year_id'] },
      { fields: ['currency_id'] },
      { fields: ['system_default_currency_id'] },
      { fields: ['status'] },
      { fields: ['companyId'] }
    ]
  });

  return Receipt;
};

