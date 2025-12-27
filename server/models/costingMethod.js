const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const CostingMethod = sequelize.define('CostingMethod', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    unique: true
  },
  name: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
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
          allowNull: true, // Global data - can be null for shared reference data
          field: 'companyId', // Explicitly set field name
          references: {
             model: 'company',
              key: 'id'
          },

      }
}, {
  tableName: 'costing_methods',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = CostingMethod; 