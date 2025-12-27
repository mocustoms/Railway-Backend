// Utility functions for data transformation between snake_case (database) and camelCase (frontend)

// Transform stock adjustment data from snake_case to camelCase
function transformStockAdjustment(adjustment) {
    if (!adjustment) return null;
    
    const result = {
        id: adjustment.id,
        reference: adjustment.reference_number,
        date: adjustment.adjustment_date,
        adjustmentType: adjustment.adjustment_type,
        reasonId: adjustment.reason_id,
        storeId: adjustment.store_id,
        currencyId: adjustment.currency_id,
        systemCurrencyId: adjustment.system_currency_id,
        transactionTypeId: adjustment.transaction_type_id,
        financialYearId: adjustment.financial_year_id,
        accountId: adjustment.account_id,
        exchangeRate: adjustment.exchange_rate,
        equivalentAmount: adjustment.equivalent_amount,
        userAmount: adjustment.user_amount,
        conversionNotes: adjustment.conversion_notes,
        documentNumber: adjustment.document_number,
        documentType: adjustment.document_type,
        totalItems: adjustment.total_items,
        totalValue: adjustment.total_value,
        totalCurrentStock: adjustment.total_current_stock,
        totalNewStock: adjustment.total_new_stock,
        notes: adjustment.notes,
        status: adjustment.status,
        submittedBy: adjustment.submitted_by,
        submittedAt: adjustment.submitted_at,
        createdBy: adjustment.created_by,
        updatedBy: adjustment.updated_by,
        approvedBy: adjustment.approved_by,
        createdAt: adjustment.created_at,
        updatedAt: adjustment.updated_at,
        approvedAt: adjustment.approved_at,
        // Related data
        reason: adjustment.reason ? {
            id: adjustment.reason.id,
            name: adjustment.reason.name,
            description: adjustment.reason.description,
            trackingAccountId: adjustment.reason.tracking_account_id,
            adjustmentType: adjustment.reason.adjustment_type,
            isActive: adjustment.reason.is_active,
            trackingAccount: adjustment.reason.trackingAccount ? {
                id: adjustment.reason.trackingAccount.id,
                code: adjustment.reason.trackingAccount.code,
                name: adjustment.reason.trackingAccount.name
            } : null,
            correspondingAccount: adjustment.reason.correspondingAccount ? {
                id: adjustment.reason.correspondingAccount.id,
                code: adjustment.reason.correspondingAccount.code,
                name: adjustment.reason.correspondingAccount.name
            } : null
        } : null,
        store: adjustment.store ? {
            id: adjustment.store.id,
            name: adjustment.store.name,
            location: adjustment.store.location,
            isActive: adjustment.store.is_active
        } : null,
        currency: adjustment.currency ? {
            id: adjustment.currency.id,
            code: adjustment.currency.code,
            name: adjustment.currency.name,
            symbol: adjustment.currency.symbol,
            isDefault: adjustment.currency.is_default
        } : null,
        transactionType: adjustment.transactionType ? {
            id: adjustment.transactionType.id,
            name: adjustment.transactionType.name,
            description: adjustment.transactionType.description
        } : null,
        financialYear: adjustment.financialYear ? {
            id: adjustment.financialYear.id,
            name: adjustment.financialYear.name,
            startDate: adjustment.financialYear.startDate,
            endDate: adjustment.financialYear.endDate,
            isCurrent: adjustment.financialYear.isCurrent
        } : null,
        account: adjustment.account ? {
            id: adjustment.account.id,
            code: adjustment.account.code,
            name: adjustment.account.name,
            type: adjustment.account.type
        } : null,
        createdByUser: adjustment.createdByUser ? {
            id: adjustment.createdByUser.id,
            firstName: adjustment.createdByUser.first_name,
            lastName: adjustment.createdByUser.last_name,
            email: adjustment.createdByUser.email,
            username: adjustment.createdByUser.username
        } : null,
        submittedByUser: adjustment.submittedByUser ? {
            id: adjustment.submittedByUser.id,
            firstName: adjustment.submittedByUser.first_name,
            lastName: adjustment.submittedByUser.last_name,
            email: adjustment.submittedByUser.email,
            username: adjustment.submittedByUser.username
        } : null,
        updatedByUser: adjustment.updatedByUser ? {
            id: adjustment.updatedByUser.id,
            firstName: adjustment.updatedByUser.first_name,
            lastName: adjustment.updatedByUser.last_name,
            email: adjustment.updatedByUser.email,
            username: adjustment.updatedByUser.username
        } : null,
        approvedByUser: adjustment.approvedByUser ? {
            id: adjustment.approvedByUser.id,
            firstName: adjustment.approvedByUser.first_name,
            lastName: adjustment.approvedByUser.last_name,
            email: adjustment.approvedByUser.email,
            username: adjustment.approvedByUser.username
        } : null,
        items: adjustment.items ? adjustment.items.map(transformStockAdjustmentItem) : []
    };
    
    return result;
}

// Transform stock adjustment item data from snake_case to camelCase
function transformStockAdjustmentItem(item) {
    if (!item) return null;
    
    return {
        id: item.id,
        adjustmentId: item.adjustment_id,
        productId: item.product_id,
        currentStock: item.current_stock,
        adjustedStock: item.adjusted_stock,
        quantityChange: item.quantity_change,
        quantityIn: item.quantity_in,
        quantityOut: item.quantity_out,
        unitCost: item.user_unit_cost, // Map user_unit_cost to unitCost for frontend
        userUnitCost: item.user_unit_cost,
        productAverageCost: item.product_average_cost,
        totalValue: item.total_value,
        systemCurrencyId: item.system_currency_id,
        conversionNotes: item.conversion_notes,
        batchNumber: item.batch_number,
        expiryDate: item.expiry_date,
        serialNumber: item.serial_number,
        serialNumbers: item.serial_numbers,
        notes: item.notes,
        exchangeRate: item.exchange_rate,
        equivalentAmount: item.equivalent_amount,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        // Related product data
        product: item.product ? {
            id: item.product.id,
            name: item.product.name,
            code: item.product.code,
            description: item.product.description,
            trackSerialNumber: item.product.track_serial_number,
            expiryNotificationDays: item.product.expiry_notification_days,
            averageCost: item.product.average_cost
        } : null
    };
}

// Transform array of stock adjustments
function transformStockAdjustments(adjustments) {
    if (!Array.isArray(adjustments)) return [];
    return adjustments.map(transformStockAdjustment);
}

module.exports = {
    transformStockAdjustment,
    transformStockAdjustmentItem,
    transformStockAdjustments
};
