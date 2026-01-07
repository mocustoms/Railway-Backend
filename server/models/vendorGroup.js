const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const VendorGroup = sequelize.define(
  "VendorGroup",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    vendor_group_code: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    vendor_group_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    liablity_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "accounts", key: "id" },
    },
    payable_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "accounts", key: "id" },
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "company", key: "id" },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    updated_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "vendor_groups",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["vendor_group_code"],
      },
      {
        unique: true,
        fields: ["companyId"],
      },
    ],
  }
);

module.exports = VendorGroup;
