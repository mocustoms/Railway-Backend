const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LinkedAccount = sequelize.define('LinkedAccount', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
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
    account_type: {
      type: DataTypes.ENUM(
        'customer_deposits',
        'payables',
        'receivables',
        'cost_of_goods_sold',
        'inventory',
        'sales_revenue',
        'discounts_allowed',
        'discounts_received',
        'opening_balance_equity',
        'current_earnings',
        'retained_earnings',
        'sales_returns_liability',
        'account_balance',
        'loyalty_cards',
        'cash_customer',
        'withholding_tax_payable'
      ),
      allowNull: false,

    },
    account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      },

    },
    customer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'customers',
        key: 'id'
      },

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
    }
  }, {
    tableName: 'linked_accounts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['companyId', 'account_type'],
        name: 'linked_accounts_companyId_account_type_unique'
      },
      { fields: ['companyId'] },
      { fields: ['account_type'] },
      { fields: ['account_id'] }
    ]
  });

  return LinkedAccount;
};

