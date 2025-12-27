const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const PriceChangeReason = sequelize.define('PriceChangeReason', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    // unique: true removed - using composite unique index with companyId instead

  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  category: {
    type: DataTypes.ENUM('cost', 'selling', 'both'),
    allowNull: false,
    defaultValue: 'both'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.UUID,
    allowNull: true
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
  tableName: 'price_change_reasons',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['code', 'companyId'],
      name: 'price_change_reasons_code_companyId_unique'
    },
    {
      fields: ['companyId']
    }
  ]
});

module.exports = PriceChangeReason; 