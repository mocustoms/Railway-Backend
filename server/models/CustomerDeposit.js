const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CustomerDeposit = sequelize.define('CustomerDeposit', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    depositReferenceNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'deposit_reference_number',

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
    paymentTypeId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'payment_type_id',
      references: {
        model: 'payment_types',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    },
    chequeNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'cheque_number'
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
      type: DataTypes.STRING,
      allowNull: true,
      field: 'branch',

    },
    currencyId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'currency_id',
      references: {
        model: 'currencies',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    },
    exchangeRate: {
      type: DataTypes.DECIMAL(15, 6),
      allowNull: false,
      defaultValue: 1.000000,
      field: 'exchange_rate'
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
      onUpdate: 'CASCADE'
    },
    documentPath: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'document_path'
    },
    depositAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      field: 'deposit_amount'
    },
    equivalentAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      field: 'equivalent_amount',

    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    liabilityAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'liability_account_id',
      references: {
        model: 'accounts',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    },
    assetAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'asset_account_id',
      references: {
        model: 'accounts',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    },
    transactionDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'transaction_date'
    },
    financialYearId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'financial_year_id',
      references: {
        model: 'financial_years',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',

    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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
      field: 'companyId', // Explicitly set field name
      references: {
       model: 'company',
        key: 'id'
      },

    },
  }, {
    tableName: 'customer_deposits',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['deposit_reference_number', 'companyId'],
        name: 'customer_deposits_deposit_reference_number_companyId_unique'
      },
      { fields: ['companyId'] },
      { fields: ['customer_id'] },
      { fields: ['transaction_date'] },
      { fields: ['financial_year_id'] }
    ]
  });


  return CustomerDeposit;
};
