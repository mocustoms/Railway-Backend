const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const AutoCode = sequelize.define('AutoCode', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    module_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    module_display_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        },

    },
    code_type: {
        type: DataTypes.ENUM('code', 'reference_number', 'barcode', 'invoice_number', 'receipt_number'),
        allowNull: false,
        defaultValue: 'code',

    },
    prefix: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 20]
        },

    },
    format: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        },

    },
    next_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: {
            min: 1
        },

    },
    number_padding: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 4,
        validate: {
            min: 1,
            max: 10
        },

    },
    last_used: {
        type: DataTypes.DATE,
        allowNull: true,

    },
    status: {
        type: DataTypes.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active'
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,

    },
    created_by: {
        type: DataTypes.UUID,
        allowNull: false,
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
    tableName: 'auto_codes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['module_name', 'companyId'],
            name: 'auto_codes_module_name_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['status']
        },
        {
            fields: ['code_type']
        },
        {
            fields: ['created_by']
        }
    ]
});

module.exports = AutoCode; 