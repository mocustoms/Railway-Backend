const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PaymentType = sequelize.define('PaymentType', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING(20),
      allowNull: false,
      // Unique constraint is composite: ['code', 'companyId'] - defined in indexes
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    payment_method_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'payment_methods',
        key: 'id'
      }
    },
    order_of_display: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    default_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    used_in_sales: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    used_in_debtor_payments: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    used_in_credit_payments: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    used_in_customer_deposits: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    used_in_refunds: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    display_in_cashier_report: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    used_in_banking: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
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
    tableName: 'payment_types',
    timestamps: true,
    underscored: true,
  });

  return PaymentType;
}; 