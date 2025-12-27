'use strict';
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class StoreRequestItemTransaction extends Model {
    static associate(models) {
      // Store request item relationship
      StoreRequestItemTransaction.belongsTo(models.StoreRequestItem, { 
        as: 'storeRequestItem', 
        foreignKey: 'store_request_item_id' 
      });
      
      // User relationship
      StoreRequestItemTransaction.belongsTo(models.User, { 
        as: 'performedByUser', 
        foreignKey: 'performed_by' 
      });
    }
  }

  StoreRequestItemTransaction.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    store_request_item_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'store_request_items',
        key: 'id'
      }
    },
    // Transaction Details
    transaction_type: {
      type: DataTypes.ENUM('requested', 'approved', 'issued', 'received', 'fulfilled', 'rejected'),
      allowNull: false
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    previous_quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    new_quantity: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    // User and Timestamp
    performed_by: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    performed_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    // Additional Info
    notes: DataTypes.TEXT,
    reason: DataTypes.TEXT,
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
    sequelize,
    modelName: 'StoreRequestItemTransaction',
    tableName: 'store_request_item_transactions',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false // This table doesn't have updated_at
  });

  return StoreRequestItemTransaction;
};
