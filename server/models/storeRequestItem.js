'use strict';
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class StoreRequestItem extends Model {
    static associate(models) {
      // Store request relationship
      StoreRequestItem.belongsTo(models.StoreRequest, { 
        as: 'storeRequest', 
        foreignKey: 'store_request_id' 
      });
      
      // Product relationship
      StoreRequestItem.belongsTo(models.Product, { 
        as: 'product', 
        foreignKey: 'product_id' 
      });
      
      // Currency relationship
      StoreRequestItem.belongsTo(models.Currency, { 
        as: 'currency', 
        foreignKey: 'currency_id' 
      });
      
      // User relationships
      StoreRequestItem.belongsTo(models.User, { 
        as: 'createdByUser', 
        foreignKey: 'created_by' 
      });
      StoreRequestItem.belongsTo(models.User, { 
        as: 'updatedByUser', 
        foreignKey: 'updated_by' 
      });
      StoreRequestItem.belongsTo(models.User, { 
        as: 'fulfilledByUser', 
        foreignKey: 'fulfilled_by' 
      });
      
      // Transaction history relationship
      StoreRequestItem.hasMany(models.StoreRequestItemTransaction, { 
        as: 'transactions', 
        foreignKey: 'store_request_item_id' 
      });
    }
  }

  StoreRequestItem.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    store_request_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'store_requests',
        key: 'id'
      }
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id'
      }
    },
    // Quantity Tracking (Complete Lifecycle)
    requested_quantity: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    available_quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    approved_quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    fulfilled_quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    issued_quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    received_quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    remaining_quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    remaining_receiving_quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    // Cost Tracking
    unit_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    total_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false
    },
    currency_id: {
      type: DataTypes.UUID,
      references: {
        model: 'currencies',
        key: 'id'
      }
    },
    exchange_rate: {
      type: DataTypes.DECIMAL(10, 4),
      defaultValue: 1.0
    },
    equivalent_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0
    },
    // Status Tracking
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'issued', 'received', 'fulfilled', 'rejected', 'partial_issued', 'partially_received', 'fully_received', 'closed_partially_received'),
      defaultValue: 'pending'
    },
    rejection_reason: DataTypes.TEXT,
    notes: DataTypes.TEXT,
    // Additional fields
    batch_number: DataTypes.STRING(100),
    expiry_date: DataTypes.DATEONLY,
    serial_numbers: DataTypes.TEXT,
    fulfilled_at: DataTypes.DATE,
    fulfilled_by: {
      type: DataTypes.UUID,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    created_by: {
      type: DataTypes.UUID,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    updated_by: {
      type: DataTypes.UUID,
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
    sequelize,
    modelName: 'StoreRequestItem',
    tableName: 'store_request_items',
    timestamps: true,
    hooks: {
      beforeUpdate: async (item, options) => {
        // Auto-calculate status based on quantities
        if (item.changed('received_quantity') || item.changed('issued_quantity')) {
          const receivedQty = parseInt(item.received_quantity || 0);
          const issuedQty = parseInt(item.issued_quantity || 0);
          
          if (issuedQty === 0) {
            // No items issued yet
            if (item.status === 'approved') {
              item.status = 'approved';
            } else if (item.status === 'pending') {
              item.status = 'pending';
            }
          } else if (receivedQty === 0) {
            // Items issued but nothing received yet
            item.status = 'issued';
          } else if (receivedQty < issuedQty) {
            // Partially received
            item.status = 'partially_received';
          } else if (receivedQty === issuedQty) {
            // Fully received
            item.status = 'fully_received';
          }
        }
      }
    }
  });

  return StoreRequestItem;
};