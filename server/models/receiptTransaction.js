'use strict';
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ReceiptTransaction = sequelize.define('ReceiptTransaction', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    uuid: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      unique: true,
      allowNull: false,

    },
    systemDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'system_date',

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
      onUpdate: 'CASCADE'
    },
    financialYearName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'financial_year_name',

    },
    transactionTypeId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'transaction_type_id',
      references: {
        model: 'transaction_types',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',

    },
    transactionTypeName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'transaction_type_name',

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
      onUpdate: 'CASCADE',

    },
    invoiceReferenceNumber: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'invoice_reference_number',

    },
    storeId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'store_id',
      references: {
        model: 'stores',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

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
    customerName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'customer_name',

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
    salesAgentName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'sales_agent_name',

    },
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
    paymentTypeName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'payment_type_name',

    },
    paymentMethod: {
      type: DataTypes.ENUM('payment_type', 'customer_deposit', 'loyalty_points', 'mixed'),
      allowNull: false,
      field: 'payment_method',

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
    systemCurrencyId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'system_currency_id',
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
    paymentAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      field: 'payment_amount',

    },
    equivalentAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      field: 'equivalent_amount',

    },
    depositAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,
      field: 'deposit_amount',

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
    accountReceivableCode: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'account_receivable_code',

    },
    accountReceivableName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'account_receivable_name',

    },
    assetAccountCode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'asset_account_code',

    },
    assetAccountName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'asset_account_name',

    },
    liabilityAccountCode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'liability_account_code',

    },
    liabilityAccountName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'liability_account_name',

    },
    loyaltyAccountId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'loyalty_account_id',
      references: {
        model: 'accounts',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    loyaltyAccountCode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'loyalty_account_code',

    },
    loyaltyAccountName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'loyalty_account_name',

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
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'description',

    },
    referenceNumber: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'reference_number',

    },
    referenceType: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'reference_type',

    },
    transactionStatus: {
      type: DataTypes.ENUM('active', 'reversed', 'cancelled'),
      allowNull: false,
      defaultValue: 'active',
      field: 'transaction_status',

    },
    isReversal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_reversal',

    },
    reversedReceiptId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'reversed_receipt_id',
      references: {
        model: 'receipts',
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
    createdById: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'created_by_id',
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',

    },
    createdByName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'created_by_name',

    },
    updatedById: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'updated_by_id',
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'notes',

    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active',

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
    tableName: 'receipt_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['uuid'],
        name: 'receipt_transactions_uuid_unique_idx'
      },
      { fields: ['receipt_id'] },
      { fields: ['sales_invoice_id'] },
      { fields: ['customer_id'] },
      { fields: ['sales_agent_id'] },
      { fields: ['transaction_date'] },
      { fields: ['financial_year_id'] },
      { fields: ['transaction_type_id'] },
      { fields: ['receipt_reference_number'] },
      { fields: ['invoice_reference_number'] },
      { fields: ['store_id'] },
      { fields: ['currency_id'] },
      { fields: ['transaction_status'] },
      { fields: ['companyId'] }
    ]
  });

  return ReceiptTransaction;
};

