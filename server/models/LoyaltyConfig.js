const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LoyaltyConfig = sequelize.define('LoyaltyConfig', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    config_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'config_name',
      // unique: true removed - using composite unique index with companyId instead

    },
    points_per_dollar: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 1.00
    },
    redemption_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 100.00
    },
    minimum_redemption_points: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 100
    },
    maximum_redemption_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 50.00
    },
    points_expiry_days: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    tier_bronze_threshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    tier_silver_threshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1000
    },
    tier_gold_threshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5000
    },
    tier_platinum_threshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 10000
    },
    birthday_bonus_points: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    welcome_bonus_points: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
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
    tableName: 'loyalty_configs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['config_name', 'companyId'],
        name: 'loyalty_card_configs_config_name_companyId_unique'
      },
      {
        fields: ['companyId']
      },
      {
        fields: ['is_active']
      }
    ]
  });

  return LoyaltyConfig;
};
