const { DataTypes, Op } = require('sequelize');
const sequelize = require('../../config/database');

const FinancialYear = sequelize.define('FinancialYear', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        // DO NOT use unique: true here - it would enforce GLOBAL uniqueness
        // Multi-tenant: uniqueness is enforced per company via composite index ['name', 'companyId']
        // The database constraint handles per-company uniqueness
        // We skip Sequelize validation and let the database handle uniqueness
        validate: {
            notEmpty: true,
            len: [1, 100]
        },
        // Skip Sequelize's automatic uniqueness validation
        // The database composite unique index will enforce per-company uniqueness
        skipValidation: false
    },
    startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: {
            notNull: true,
            isDate: true
        }
    },
    endDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: {
            notNull: true,
            isDate: true
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    isCurrent: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
    },
    isClosed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    closedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    closedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    closingNotes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    createdBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    updatedBy: {
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
    tableName: 'financial_years',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [
        {
            unique: true,
            fields: ['name', 'companyId'],
            name: 'financial_years_name_companyId_unique'
        },
        {
            fields: ['companyId']
        },
        {
            fields: ['isCurrent']
        },
        {
            fields: ['isActive']
        },
        {
            fields: ['isClosed']
        },
        {
            fields: ['startDate']
        },
        {
            fields: ['endDate']
        }
    ],
    hooks: {
        beforeCreate: async (financialYear) => {
            // If this is the first financial year, make it current
            const count = await FinancialYear.count();
            if (count === 0) {
                financialYear.isCurrent = true;
            }
        },
        beforeUpdate: async (financialYear) => {
            // If setting this year as current, unset all others
            if (financialYear.changed('isCurrent') && financialYear.isCurrent) {
                await FinancialYear.update(
                    { isCurrent: false },
                    { 
                        where: { 
                            id: { [Op.ne]: financialYear.id },
                            isCurrent: true 
                        } 
                    }
                );
            }
            
            // If closing the year, validate it can be closed
            if (financialYear.changed('isClosed') && financialYear.isClosed) {
                await financialYear.validateForClosing();
            }
        }
    }
});

// Instance methods
FinancialYear.prototype.isDateInRange = function(date) {
    const checkDate = new Date(date);
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    return checkDate >= start && checkDate <= end;
};

FinancialYear.prototype.getDurationInDays = function() {
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

FinancialYear.prototype.isOpen = function() {
    return this.isActive && !this.isClosed;
};

FinancialYear.prototype.canBeClosed = async function() {
    // Check if it's the current year
    if (this.isCurrent) {
        return false;
    }
    
    // Check if it's already closed
    if (this.isClosed) {
        return false;
    }
    
    // Check if it's active
    if (!this.isActive) {
        return false;
    }
    
    // Check if the end date has passed
    const today = new Date();
    const endDate = new Date(this.endDate);
    if (today <= endDate) {
        return false;
    }
    
    return true;
};

FinancialYear.prototype.validateForClosing = async function() {
    const canClose = await this.canBeClosed();
    if (!canClose) {
        throw new Error('Financial year cannot be closed. It may be the current year, already closed, inactive, or the end date has not passed.');
    }
};

FinancialYear.prototype.close = async function(userId, notes = null) {
    await this.validateForClosing();
    
    this.isClosed = true;
    this.closedAt = new Date();
    this.closedBy = userId;
    this.closingNotes = notes;
    
    return await this.save();
};

FinancialYear.prototype.reopen = async function(userId, notes = null) {
    if (!this.isClosed) {
        throw new Error('Financial year is not closed and cannot be reopened.');
    }
    
    this.isClosed = false;
    this.closedAt = null;
    this.closedBy = null;
    this.closingNotes = notes;
    this.updatedBy = userId;
    
    return await this.save();
};

// Class methods
FinancialYear.getCurrentYear = async function() {
    return await this.findOne({
        where: { isCurrent: true, isActive: true }
    });
};

FinancialYear.getOpenYears = async function() {
    return await this.findAll({
        where: { 
            isActive: true,
            isClosed: false
        },
        order: [['startDate', 'DESC']]
    });
};

FinancialYear.getClosedYears = async function() {
    return await this.findAll({
        where: { 
            isActive: true,
            isClosed: true
        },
        order: [['closedAt', 'DESC']]
    });
};

FinancialYear.getYearForDate = async function(date) {
    const checkDate = new Date(date);
    return await this.findOne({
        where: {
            startDate: { [Op.lte]: checkDate },
            endDate: { [Op.gte]: checkDate },
            isActive: true
        }
    });
};

FinancialYear.setCurrentYear = async function(yearId) {
    // First, unset all current years
    await this.update(
        { isCurrent: false },
        { where: { isCurrent: true } }
    );
    
    // Then set the specified year as current
    return await this.update(
        { isCurrent: true },
        { where: { id: yearId } }
    );
};

FinancialYear.isDateInOpenYear = async function(date) {
    const checkDate = new Date(date);
    const openYear = await this.findOne({
        where: {
            startDate: { [Op.lte]: checkDate },
            endDate: { [Op.gte]: checkDate },
            isActive: true,
            isClosed: false
        }
    });
    
    return !!openYear;
};

FinancialYear.getOpenYearForDate = async function(date) {
    const checkDate = new Date(date);
    return await this.findOne({
        where: {
            startDate: { [Op.lte]: checkDate },
            endDate: { [Op.gte]: checkDate },
            isActive: true,
            isClosed: false
        }
    });
};

module.exports = FinancialYear; 