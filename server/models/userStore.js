const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

class UserStore extends Model {}

UserStore.init({
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    store_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'stores',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    role: {
        type: DataTypes.ENUM('manager', 'cashier', 'viewer'),
        defaultValue: 'cashier',
        allowNull: false,
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,

    },
    assigned_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },

    },
    assigned_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
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
    modelName: 'UserStore',
    tableName: 'user_stores',
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['user_id', 'store_id']
        },
        {
            fields: ['companyId']
        }
    ]
});

module.exports = UserStore; 