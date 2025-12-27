const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Supplier = sequelize.define('Supplier', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  supplier_id: {
    type: DataTypes.STRING(30),
    allowNull: false,

  },
  full_name: {
    type: DataTypes.STRING(150),
    allowNull: false
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  fax: {
    type: DataTypes.STRING(50),
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
  tableName: 'supplier',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { 
      unique: true, 
      fields: ['supplier_id', 'companyId'],
      name: 'supplier_supplier_id_companyId_unique'
    },
    { 
      unique: true, 
      fields: ['full_name', 'companyId'],
      name: 'supplier_full_name_companyId_unique'
    },
    { fields: ['companyId'] }
  ]
});

Supplier.associate = (models) => {
  Supplier.belongsTo(models.User, { as: 'creator', foreignKey: 'created_by' });
  Supplier.belongsTo(models.User, { as: 'updater', foreignKey: 'updated_by' });
};

module.exports = Supplier;

