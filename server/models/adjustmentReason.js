const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const AdjustmentReason = sequelize.define('AdjustmentReason', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 50]
        },

    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    adjustment_type: {
        type: DataTypes.ENUM('add', 'deduct'),
        allowNull: false,
        validate: {
            isIn: [['add', 'deduct']]
        }
    },
    tracking_account_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    corresponding_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    created_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    updated_by: {
        type: DataTypes.UUID,
        allowNull: true,
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
    tableName: 'adjustment_reasons',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'adjustment_reasons_code_companyId_unique'
        },
        {
            unique: true,
            fields: ['name', 'companyId'],
            name: 'adjustment_reasons_name_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['name']
        },
        {
            fields: ['adjustment_type']
        },
        {
            fields: ['tracking_account_id']
        },
        {
            fields: ['is_active']
        }
    ]
});

// Define associations
AdjustmentReason.associate = (models) => {
    AdjustmentReason.belongsTo(models.User, {
        foreignKey: 'created_by',
        as: 'createdByUser'
    });
    
    AdjustmentReason.belongsTo(models.User, {
        foreignKey: 'updated_by',
        as: 'updatedByUser'
    });
    
    AdjustmentReason.belongsTo(models.Account, {
        foreignKey: 'tracking_account_id',
        as: 'trackingAccount'
    });

    AdjustmentReason.belongsTo(models.Account, {
        foreignKey: 'corresponding_account_id',
        as: 'correspondingAccount'
    });
};

module.exports = AdjustmentReason; 