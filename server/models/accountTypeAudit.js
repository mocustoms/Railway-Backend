const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AccountTypeAudit = sequelize.define('AccountTypeAudit', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    account_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    action: {
      type: DataTypes.ENUM('create', 'update', 'delete'),
      allowNull: false,
    },
    changed_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    changed_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    old_data: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    new_data: {
      type: DataTypes.JSON,
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

    },
  }, {
    tableName: 'account_type_audits',
    timestamps: false,
  });

  return AccountTypeAudit;
}; 