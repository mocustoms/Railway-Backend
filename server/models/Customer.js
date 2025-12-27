const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Customer = sequelize.define('Customer', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  customer_id: {
    type: DataTypes.STRING(30),
    allowNull: false,

  },
  customer_group_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'customer_groups', key: 'id' }
  },
  full_name: {
    type: DataTypes.STRING(150),
    allowNull: false
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  default_receivable_account_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'accounts', key: 'id' }
  },
  fax: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  loyalty_card_number: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  loyalty_card_config_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'loyalty_card_configs', key: 'id' }
  },
  birthday: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  phone_number: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  email: {
    type: DataTypes.STRING(150),
    allowNull: true,
    validate: { isEmail: true }
  },
  website: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  account_balance: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00,

  },
  debt_balance: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00,

  },
  deposit_balance: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00,

  },
  loyalty_points: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00,

  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  updated_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' }
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
  tableName: 'customers',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { 
      unique: true, 
      fields: ['customer_id', 'companyId'],
      name: 'customers_customer_id_companyId_unique'
    },
    { 
      unique: true, 
      fields: ['full_name', 'companyId'],
      name: 'customers_full_name_companyId_unique'
    },
    { fields: ['customer_group_id'] },
    { fields: ['default_receivable_account_id'] },
    { fields: ['loyalty_card_config_id'] },
    { fields: ['is_active'] },
    { fields: ['companyId'] }
  ]
});

Customer.associate = (models) => {
  Customer.belongsTo(models.CustomerGroup, { as: 'group', foreignKey: 'customer_group_id' });
  Customer.belongsTo(models.Account, { as: 'defaultReceivableAccount', foreignKey: 'default_receivable_account_id' });
  Customer.belongsTo(models.LoyaltyCardConfig, { as: 'loyaltyCardConfig', foreignKey: 'loyalty_card_config_id' });
  Customer.belongsTo(models.User, { as: 'creator', foreignKey: 'created_by' });
  Customer.belongsTo(models.User, { as: 'updater', foreignKey: 'updated_by' });
};

module.exports = Customer;


