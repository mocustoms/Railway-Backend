module.exports = (sequelize, DataTypes) => {
  const VendorProduct = sequelize.define('VendorProduct', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    vendor_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'vendors', key: 'id' }
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'products', key: 'id' }
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'company', key: 'id' }
    }
  }, {
    tableName: 'vendor_products',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['vendor_id'] },
      { fields: ['product_id'] }
    ]
  });

  VendorProduct.associate = (models) => {
    VendorProduct.belongsTo(models.Vendor, { as: 'vendor', foreignKey: 'vendor_id' });
    VendorProduct.belongsTo(models.Product, { as: 'product', foreignKey: 'product_id' });
  };

  return VendorProduct;
};
