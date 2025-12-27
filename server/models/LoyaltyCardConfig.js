const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LoyaltyCardConfig = sequelize.define('LoyaltyCardConfig', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    loyalty_card_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 100]
      },

    },
    loyalty_card_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 20]
      },

    },
    card_color: {
      type: DataTypes.STRING(7),
      allowNull: true,
      defaultValue: '#FFD700'
    },
    entrance_points: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    allow_gaining_cash_sales: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    allow_gaining_credit_sales: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    redemption_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 100.00
    },
    minimum_redemption_points: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 100
    },
    maximum_redemption_points: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 1000
    },
    birthday_bonus_points: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    welcome_bonus_points: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    // Gain Rates Configuration
    gain_rate_lower_limit: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    gain_rate_upper_limit: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 999999.99
    },
    gain_rate_type: {
      type: DataTypes.ENUM('fixed', 'percentage'),
      allowNull: true,
      defaultValue: 'percentage'
    },
    gain_rate_value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 1.00
    },
    // Discount Rates Configuration
    discount_rate_lower_limit: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    discount_rate_upper_limit: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 999999.99
    },
    discount_rate_type: {
      type: DataTypes.ENUM('fixed', 'percentage'),
      allowNull: true,
      defaultValue: 'percentage'
    },
    discount_rate_value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0.00
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
    tableName: 'loyalty_card_configs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['loyalty_card_name', 'companyId'],
        name: 'loyalty_card_configs_loyalty_card_name_companyId_unique'
      },
      {
        unique: true,
        fields: ['loyalty_card_code', 'companyId'],
        name: 'loyalty_card_configs_loyalty_card_code_companyId_unique'
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['is_default']
      },
      {
        fields: ['created_by']
      }
    ]
  });

  // Define associations
  LoyaltyCardConfig.associate = (models) => {
    // Created by user association
    LoyaltyCardConfig.belongsTo(models.User, {
      as: 'createdByUser',
      foreignKey: 'created_by',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    });

    // Updated by user association
    LoyaltyCardConfig.belongsTo(models.User, {
      as: 'updatedByUser',
      foreignKey: 'updated_by',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    });

    // Company association
    LoyaltyCardConfig.belongsTo(models.Company, {
      as: 'company',
      foreignKey: 'companyId',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    });
  };

  return LoyaltyCardConfig;
};
