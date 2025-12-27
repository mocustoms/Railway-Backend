'use strict';
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class StoreRequest extends Model {
    // Model methods can be added here if needed
  }

  StoreRequest.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    reference_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      // unique: true removed - using composite unique index with companyId instead

    },
    request_date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    requested_by_store_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      }
    },
    requested_from_store_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('draft', 'submitted', 'approved', 'rejected', 'fulfilled', 'partial_issued', 'partially_received', 'fully_received', 'cancelled', 'partial_issued_cancelled', 'partially_received_cancelled'),
      defaultValue: 'draft'
    },
    priority: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
      defaultValue: 'medium'
    },
    request_type: {
      type: DataTypes.ENUM('request', 'issue'),
      defaultValue: 'request'
    },
    expected_delivery_date: DataTypes.DATEONLY,
    actual_delivery_date: DataTypes.DATEONLY,
    notes: DataTypes.TEXT,
    rejection_reason: DataTypes.TEXT,
    total_items: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    total_value: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0
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
    // Workflow fields
    submitted_at: DataTypes.DATE,
    submitted_by: {
      type: DataTypes.UUID,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    approved_at: DataTypes.DATE,
    approved_by: {
      type: DataTypes.UUID,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    rejected_at: DataTypes.DATE,
    rejected_by: {
      type: DataTypes.UUID,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    approval_notes: DataTypes.TEXT,
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
    modelName: 'StoreRequest',
    tableName: 'store_requests',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['reference_number', 'companyId'],
        name: 'store_requests_reference_number_companyId_unique'
      },
      {
        fields: ['companyId']
      },
      {
        fields: ['requested_by_store_id']
      },
      {
        fields: ['requested_from_store_id']
      },
      {
        fields: ['status']
      }
    ]
  });

  return StoreRequest;
};