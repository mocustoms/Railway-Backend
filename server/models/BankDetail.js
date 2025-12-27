const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BankDetail = sequelize.define('BankDetail', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING,
      allowNull: false,
      // Unique constraint is composite: ['code', 'companyId'] - defined in indexes
    },
    bankName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'bank_name'
    },
    branch: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'account_number'
    },
    accountId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'account_id',
      references: {
        model: 'accounts',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'created_by',
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    },
    updatedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'updated_by',
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
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
    tableName: 'bank_details',
    timestamps: true, // adds createdAt and updatedAt
    underscored: true,
  });

  return BankDetail;
};
