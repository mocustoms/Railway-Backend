const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LoyaltyCard = sequelize.define('LoyaltyCard', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    card_number: {
      type: DataTypes.STRING(20),
      allowNull: false,
      // unique: true removed - using composite unique index with companyId instead

    },
    loyalty_config_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'loyalty_card_configs',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    customer_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    customer_email: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    customer_phone: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    current_points: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    total_points_earned: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    total_points_redeemed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    tier_level: {
      type: DataTypes.ENUM('bronze', 'silver', 'gold', 'platinum'),
      allowNull: false,
      defaultValue: 'bronze'
    },
    tier_points_threshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    issued_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    last_used_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    expiry_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    updated_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true
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
    tableName: 'loyalty_cards',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['card_number', 'companyId'],
        name: 'loyalty_cards_card_number_companyId_unique'
      },
      {
        fields: ['companyId']
      },
      {
        fields: ['customer_email']
      },
      {
        fields: ['tier_level']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['created_by']
      }
    ]
  });

  return LoyaltyCard;
};
