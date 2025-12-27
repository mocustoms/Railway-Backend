const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const PhysicalInventoryReversal = sequelize.define('PhysicalInventoryReversal', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  physical_inventory_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'physical_inventories',
      key: 'id'
    }
  },
  reversed_by: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  reversal_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  reversal_reason: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
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
  tableName: 'physical_inventory_reversals',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['physical_inventory_id']
        },
        {
            fields: ['companyId'] },
    { fields: ['reversed_by'] },
    { fields: ['reversal_date'] }
  ]
});

PhysicalInventoryReversal.associate = (models) => {
  if (models.User) {
    PhysicalInventoryReversal.belongsTo(models.User, {
      foreignKey: 'reversed_by',
      as: 'reversedByUser'
    });
  }
  if (models.PhysicalInventory) {
    PhysicalInventoryReversal.belongsTo(models.PhysicalInventory, {
      foreignKey: 'physical_inventory_id',
      as: 'physicalInventory'
    });
  }
};

module.exports = PhysicalInventoryReversal; 