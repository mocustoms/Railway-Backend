const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const GeneralLedger = sequelize.define('GeneralLedger', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    financial_year_code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 20]
        },

    },
    financial_year_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'financial_years',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',

    },
    system_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,

    },
    transaction_date: {
        type: DataTypes.DATE,
        allowNull: false,

    },
    reference_number: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    transaction_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 50]
        },

    },
    transaction_type_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    transaction_type_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'transaction_types',
            key: 'id'
        },

    },
    created_by_code: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },

    },
    created_by_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        },

    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,

    },
    account_type_code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 20]
        },

    },
    account_type_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    account_type_id: {
        type: DataTypes.UUID,
        allowNull: true, // Changed to true to allow null for accounts without account types
        references: {
            model: 'account_types',
            key: 'id'
        },

    },
    account_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'accounts',
            key: 'id'
        },

    },
    account_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        },

    },
    account_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 50]
        },

    },
    account_nature: {
        type: DataTypes.ENUM('debit', 'credit'),
        allowNull: false,
        validate: {
            isIn: [['debit', 'credit']]
        },

    },
    exchange_rate: {
        type: DataTypes.DECIMAL(15, 6),
        allowNull: false,
        defaultValue: 1.000000,
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
        },
        validate: {
            min: 0
        },

    },
    amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        validate: {
            min: 0
        },

    },
    system_currency_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'currencies',
            key: 'id'
        },

    },
    user_debit_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        validate: {
            min: 0
        },

    },
    user_credit_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        validate: {
            min: 0
        },

    },
    equivalent_debit_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        validate: {
            min: 0
        },

    },
    equivalent_credit_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        validate: {
            min: 0
        },

    },
    username: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    general_ledger_id: {
        type: DataTypes.UUID,
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
    tableName: 'general_ledger',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        // Note: reference_number is NOT unique - it groups multiple ledger entries for the same transaction
        // Multiple entries can share the same reference_number (e.g., debit and credit entries)
        {
            fields: ['reference_number', 'companyId']
        },
        {
            fields: ['financial_year_code']
        },
        {
            fields: ['financial_year_id']
        },
        {
            fields: ['transaction_date']
        },
        {
            fields: ['transaction_type']
        },
        {
            fields: ['account_id']
        },
        {
            fields: ['account_type_id']
        },
        {
            fields: ['created_by_code']
        },
        {
            fields: ['general_ledger_id']
        },
        {
            fields: ['financial_year_code', 'transaction_date']
        },
        {
            fields: ['account_id', 'transaction_date']
        },
        {
            fields: ['transaction_type', 'transaction_date']
        },
        {
            fields: ['companyId']
        }
    ]
});

// Define associations
GeneralLedger.associate = function(models) {
    GeneralLedger.belongsTo(models.User, {
        foreignKey: 'created_by_code',
        as: 'createdByUser'
    });
    
    GeneralLedger.belongsTo(models.AccountType, {
        foreignKey: 'account_type_id',
        as: 'accountType'
    });
    
    GeneralLedger.belongsTo(models.Account, {
        foreignKey: 'account_id',
        as: 'account'
    });
    
    GeneralLedger.belongsTo(models.FinancialYear, {
        foreignKey: 'financial_year_id',
        as: 'financialYear'
    });
    
    GeneralLedger.belongsTo(models.GeneralLedger, {
        foreignKey: 'general_ledger_id',
        as: 'parentTransaction'
    });
    
    GeneralLedger.hasMany(models.GeneralLedger, {
        foreignKey: 'general_ledger_id',
        as: 'childTransactions'
    });

    GeneralLedger.belongsTo(models.TransactionType, {
        foreignKey: 'transaction_type_id',
        as: 'transactionType'
    });
};

module.exports = GeneralLedger; 