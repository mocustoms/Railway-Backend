const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Packaging = sequelize.define('Packaging', {
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
    pieces: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
            min: 1,
            max: 999999
        }
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
        allowNull: false
    },
    createdBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            tableName: 'users',
            key: 'id'
        }
    },
    updatedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            tableName: 'users',
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
    tableName: 'packaging',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'packaging_code_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['status']
        },
        {
            fields: ['createdBy']
        },
        {
            fields: ['updatedBy']
        }
    ]
});

module.exports = Packaging; 