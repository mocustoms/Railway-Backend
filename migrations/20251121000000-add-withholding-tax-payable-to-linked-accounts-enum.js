'use strict';

/**
 * Add 'withholding_tax_payable' to enum_linked_accounts_account_type
 * 
 * This migration adds the missing 'withholding_tax_payable' enum value
 * to the enum_linked_accounts_account_type enum type.
 * 
 * This fixes the error: "invalid input value for enum enum_linked_accounts_account_type: \"withholding_tax_payable\""
 * 
 * Note: In PostgreSQL, you cannot add enum values inside a transaction in older versions.
 * This migration handles that by checking if the value exists first, and if not,
 * adds it outside of a transaction if needed.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('🔄 Adding "withholding_tax_payable" to enum_linked_accounts_account_type...\n');
    
    try {
      // Check if enum type exists
      const [enumExists] = await queryInterface.sequelize.query(`
        SELECT 1 FROM pg_type WHERE typname = 'enum_linked_accounts_account_type'
      `, {
        type: Sequelize.QueryTypes.SELECT
      });
      
      if (!enumExists || enumExists.length === 0) {
        console.log('⚠️  Enum type enum_linked_accounts_account_type does not exist.');
        console.log('   This migration assumes the enum was created by the main schema migration.');
        console.log('   If the enum does not exist, please run the complete schema migration first.');
        return;
      }
      
      // Check if the value already exists
      const [valueExists] = await queryInterface.sequelize.query(`
        SELECT 1 
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'enum_linked_accounts_account_type'
          AND e.enumlabel = 'withholding_tax_payable'
      `, {
        type: Sequelize.QueryTypes.SELECT
      });
      
      if (valueExists && valueExists.length > 0) {
        console.log('✅ Enum value "withholding_tax_payable" already exists. Skipping.');
        return;
      }
      
      // Add the enum value
      // Note: ALTER TYPE ... ADD VALUE cannot be run inside a transaction in PostgreSQL < 12
      // We'll try without transaction first (safer for enum operations)
      try {
        // Try with IF NOT EXISTS first (PostgreSQL 9.5+)
        try {
          await queryInterface.sequelize.query(`
            ALTER TYPE enum_linked_accounts_account_type 
            ADD VALUE IF NOT EXISTS 'withholding_tax_payable'
          `);
          console.log('✅ Successfully added "withholding_tax_payable" to enum_linked_accounts_account_type');
        } catch (ifNotExistsError) {
          // If IF NOT EXISTS is not supported or fails, try without it
          if (ifNotExistsError.message.includes('syntax error') || 
              ifNotExistsError.message.includes('IF NOT EXISTS')) {
            console.log('⚠️  IF NOT EXISTS not supported. Trying without it...');
            
            await queryInterface.sequelize.query(`
              ALTER TYPE enum_linked_accounts_account_type 
              ADD VALUE 'withholding_tax_payable'
            `);
            console.log('✅ Successfully added "withholding_tax_payable" to enum_linked_accounts_account_type');
          } else if (ifNotExistsError.message.includes('already exists') || 
                     ifNotExistsError.message.includes('duplicate')) {
            console.log('✅ Enum value "withholding_tax_payable" already exists. Skipping.');
            return;
          } else {
            throw ifNotExistsError;
          }
        }
      } catch (error) {
        // Check if value already exists (might have been added between checks)
        if (error.message.includes('already exists') || 
            error.message.includes('duplicate') ||
            error.message.includes('already present')) {
          console.log('✅ Enum value "withholding_tax_payable" already exists. Skipping.');
          return;
        }
        throw error;
      }
    } catch (error) {
      console.error('❌ Error adding enum value:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    console.log('🔄 Removing "withholding_tax_payable" from enum_linked_accounts_account_type...\n');
    
    // Note: PostgreSQL does not support removing enum values directly.
    // To remove an enum value, you would need to:
    // 1. Create a new enum without the value
    // 2. Alter the table to use the new enum
    // 3. Drop the old enum
    // 
    // This is complex and risky, so we'll just log a warning.
    console.log('⚠️  PostgreSQL does not support removing enum values directly.');
    console.log('   To remove this value, you would need to:');
    console.log('   1. Create a new enum type without "withholding_tax_payable"');
    console.log('   2. Alter the linked_accounts table to use the new enum');
    console.log('   3. Drop the old enum type');
    console.log('   This is a complex operation and should be done manually if needed.');
    console.log('   For now, this migration will not remove the enum value.');
    
    // We could implement the full removal, but it's safer to leave it
    // since removing enum values is rarely needed and can break existing data
  }
};

