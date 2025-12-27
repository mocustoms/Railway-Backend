'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProductTransaction = sequelize.define('ProductTransaction', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    uuid: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        unique: true,
        allowNull: false
    },
    system_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    transaction_date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    financial_year_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    financial_year_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    transaction_type_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    transaction_type_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    store_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    product_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    product_type: {
        type: DataTypes.ENUM('resale', 'raw_materials', 'manufactured', 'services', 'pharmaceuticals'),
        allowNull: true,
    },
    manufacturer_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    model_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    brand_name_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    packaging_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    packaging_issue_quantity: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    supplier_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    customer_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    created_by_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    updated_by_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    exchange_rate: {
        type: DataTypes.DECIMAL(10, 6),
        allowNull: true,
        get() {
          const value = this.getDataValue('exchange_rate');
          if (value === null || value === undefined) {
            return 1.000000;
          }
          // Sequelize returns DECIMAL as string - clean it
          const str = String(value);
          // Remove multiple decimal points
          if (str.includes('.')) {
            const firstDotIndex = str.indexOf('.');
            const beforeDot = str.substring(0, firstDotIndex + 1);
            const afterDot = str.substring(firstDotIndex + 1).replace(/\./g, '');
            const cleaned = beforeDot + afterDot;
            return parseFloat(cleaned) || 1.000000;
          }
          return parseFloat(str) || 1.000000;
        },
        set(value) {
          // Clean value before setting
          if (value === null || value === undefined) {
            this.setDataValue('exchange_rate', 1.000000);
            return;
          }
          const str = String(value);
          // Remove multiple decimal points
          if (str.includes('.')) {
            const firstDotIndex = str.indexOf('.');
            const beforeDot = str.substring(0, firstDotIndex + 1);
            const afterDot = str.substring(firstDotIndex + 1).replace(/\./g, '');
            const cleaned = beforeDot + afterDot;
            this.setDataValue('exchange_rate', parseFloat(cleaned) || 1.000000);
          } else {
            this.setDataValue('exchange_rate', parseFloat(str) || 1.000000);
          }
        }
    },
    // --- ADDED FIELDS ---
    equivalent_amount: {
      type: DataTypes.DECIMAL,
      allowNull: true, // May be null for legacy records

      get() {
        const value = this.getDataValue('equivalent_amount');
        if (value === null || value === undefined) {
          return null;
        }
        // Sequelize returns DECIMAL as string - clean it
        const str = String(value);
        // Remove multiple decimal points
        if (str.includes('.')) {
          const firstDotIndex = str.indexOf('.');
          const beforeDot = str.substring(0, firstDotIndex + 1);
          const afterDot = str.substring(firstDotIndex + 1).replace(/\./g, '');
          const cleaned = beforeDot + afterDot;
          return parseFloat(cleaned);
        }
        return parseFloat(str);
      },
      set(value) {
        // Clean value before setting
        if (value === null || value === undefined) {
          this.setDataValue('equivalent_amount', null);
          return;
        }
        const str = String(value);
        // Remove multiple decimal points
        if (str.includes('.')) {
          const firstDotIndex = str.indexOf('.');
          const beforeDot = str.substring(0, firstDotIndex + 1);
          const afterDot = str.substring(firstDotIndex + 1).replace(/\./g, '');
          const cleaned = beforeDot + afterDot;
          this.setDataValue('equivalent_amount', parseFloat(cleaned));
        } else {
          this.setDataValue('equivalent_amount', parseFloat(str));
        }
      }
    },
    product_average_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    user_unit_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00,

    },
    system_currency_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'currencies',
        key: 'id'
      },

    },
    currency_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'currencies',
            key: 'id'
        },

    },
    expiry_date: {
        type: DataTypes.DATE,
        allowNull: true
    },
    serial_number: {
        type: DataTypes.STRING,
        allowNull: true
    },
    quantity_in: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    quantity_out: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    reference_number: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reference_type: {
        type: DataTypes.STRING,
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    conversion_notes: {
        type: DataTypes.TEXT,
        allowNull: true,

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
    tableName: 'product_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});

// Store association
ProductTransaction.belongsTo(require('./store'), {
  foreignKey: 'store_id',
  as: 'store'
});

// Product association
ProductTransaction.belongsTo(require('./product'), {
  foreignKey: 'product_id',
  as: 'product'
});

// Currency association
ProductTransaction.belongsTo(require('./currency'), {
  foreignKey: 'currency_id',
  as: 'currency'
});

// Transaction Type association
ProductTransaction.belongsTo(require('./transactionType'), {
  foreignKey: 'transaction_type_id',
  as: 'transactionType'
});

module.exports = ProductTransaction; 