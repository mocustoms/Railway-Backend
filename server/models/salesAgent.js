const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const SalesAgent = sequelize.define('SalesAgent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  agent_number: {
    type: DataTypes.STRING(20),
    allowNull: false,
    // unique: true removed - using composite unique index with companyId instead
    validate: {
      notEmpty: true,
      len: [3, 20]
    },

  },
  full_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 100]
    }
  },
  photo: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    allowNull: false,
    defaultValue: 'active'
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
    allowNull: false,
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
  tableName: 'sales_agents',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['agent_number', 'companyId'],
      name: 'sales_agents_agent_number_companyId_unique'
    },
    {
      fields: ['companyId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_by']
    },
    {
      fields: ['updated_by']
    }
  ]
});

module.exports = SalesAgent;
