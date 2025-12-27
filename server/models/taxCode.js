const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const TaxCode = sequelize.define('TaxCode', {
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
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 100]
        }
    },
    rate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.00,
        validate: {
            min: 0,
            max: 100
        }
    },
    indicator: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: {
            len: [0, 20]
        }
    },
    efd_department_code: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: {
            len: [0, 20]
        }
    },
    sales_tax_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    purchases_tax_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'accounts',
            key: 'id'
        }
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    is_wht: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
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
    tableName: 'tax_codes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['code', 'companyId'],
            name: 'tax_codes_code_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['is_active']
        },
        {
            fields: ['sales_tax_account_id']
        },
        {
            fields: ['purchases_tax_account_id']
        }
    ]
});

module.exports = TaxCode; 