const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const Vendor = sequelize.define(
  "Vendor",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    vendor_id: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    vendor_group_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "vendor_groups", key: "id" },
    },
    full_name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "company", key: "id" },
    },
    default_payable_account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "accounts", key: "id" },
    },
    fax: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    phone_number: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: true,
      validate: { isEmail: true },
    },
    website: {
      type: DataTypes.STRING(200),
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
    tableName: "vendors",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["vendor_id"],
      },
      {
        fields: ["vendor_group_id"],
      },
      {
        fields: ["companyId"],
      },
    ],
  }
);

module.exports = Vendor;
