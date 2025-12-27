const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const CustomerGroup = sequelize.define('CustomerGroup', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  group_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 100]
    }
  },
  group_code: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 20]
    },

  },
  is_default: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  account_receivable_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'accounts',
      key: 'id'
    }
  },
  default_liability_account_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'accounts',
      key: 'id'
    }
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
  tableName: 'customer_groups',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['group_code', 'companyId'],
      name: 'customer_groups_group_code_companyId_unique'
    },
    {
      unique: true,
      fields: ['group_name', 'companyId'],
      name: 'customer_groups_group_name_companyId_unique'
    },
    {
      fields: ['companyId']
    },
    {
      fields: ['is_active']
    },
    {
      fields: ['is_default']
    }
  ],
  hooks: {
    beforeSave: async (customerGroup, options) => {
      // If setting as default, unset all other defaults for the same company
      if (customerGroup.is_default && customerGroup.changed('is_default')) {
        const { Op } = require('sequelize');
        await CustomerGroup.update(
          { is_default: false },
          {
            where: {
              id: { [Op.ne]: customerGroup.id },
              is_default: true,
              companyId: customerGroup.companyId
            },
            transaction: options.transaction
          }
        );
      }
    }
  }
});

// Define associations
CustomerGroup.associate = (models) => {
  CustomerGroup.belongsTo(models.User, {
    as: 'creator',
    foreignKey: 'created_by'
  });
  
  CustomerGroup.belongsTo(models.User, {
    as: 'updater',
    foreignKey: 'updated_by'
  });

  CustomerGroup.belongsTo(models.Account, {
    as: 'accountReceivable',
    foreignKey: 'account_receivable_id',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE'
  });

  CustomerGroup.belongsTo(models.Account, {
    as: 'defaultLiabilityAccount',
    foreignKey: 'default_liability_account_id',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE'
  });
};

module.exports = CustomerGroup;
