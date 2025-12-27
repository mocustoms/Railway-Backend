'use strict';

/**
 * Create Journal Entry tables
 * 
 * Creates journal_entries and journal_entry_lines tables for the Record Ledger Entry module
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Creating Journal Entry tables...');
      
      // Check if journal_entries table exists
      const tableExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables 
         WHERE table_schema = 'public' 
         AND table_name = 'journal_entries'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (tableExists.length === 0) {
        // Create journal_entries table
        await queryInterface.createTable('journal_entries', {
          id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true
          },
          reference_number: {
            type: Sequelize.DataTypes.STRING(100),
            allowNull: false
          },
          entry_date: {
            type: Sequelize.DataTypes.DATEONLY,
            allowNull: false
          },
          description: {
            type: Sequelize.DataTypes.TEXT,
            allowNull: true
          },
          financial_year_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: {
              model: 'financial_years',
              key: 'id'
            },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          total_debit: {
            type: Sequelize.DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0.00
          },
          total_credit: {
            type: Sequelize.DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0.00
          },
          is_posted: {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
          },
          posted_at: {
            type: Sequelize.DataTypes.DATE,
            allowNull: true
          },
          posted_by: {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: {
              model: 'users',
              key: 'id'
            },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE'
          },
          created_by: {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: {
              model: 'users',
              key: 'id'
            },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE'
          },
          updated_by: {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: {
              model: 'users',
              key: 'id'
            },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE'
          },
          companyId: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: {
             model: 'company',
              key: 'id'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          created_at: {
            type: Sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          },
          updated_at: {
            type: Sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          }
        }, { transaction });

        console.log('   ✅ Created journal_entries table');

        // Create indexes for journal_entries
        await queryInterface.addIndex('journal_entries', {
          fields: ['companyId'],
          name: 'journal_entries_companyId_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entries', {
          fields: ['financial_year_id'],
          name: 'journal_entries_financial_year_id_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entries', {
          fields: ['entry_date'],
          name: 'journal_entries_entry_date_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entries', {
          fields: ['reference_number'],
          unique: true,
          name: 'journal_entries_reference_number_key',
          transaction
        });

        await queryInterface.addIndex('journal_entries', {
          fields: ['is_posted'],
          name: 'journal_entries_is_posted_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entries', {
          fields: ['created_by'],
          name: 'journal_entries_created_by_idx',
          transaction
        });

        console.log('   ✅ Created indexes for journal_entries');
      } else {
        console.log('   ℹ️  journal_entries table already exists, skipping');
      }

      // Check if journal_entry_lines table exists
      const linesTableExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables 
         WHERE table_schema = 'public' 
         AND table_name = 'journal_entry_lines'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (linesTableExists.length === 0) {
        // Create enum type for debit/credit
        const enumExists = await queryInterface.sequelize.query(
          `SELECT 1 FROM pg_type WHERE typname = 'enum_journal_entry_lines_type'`,
          { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
        );

        if (enumExists.length === 0) {
          await queryInterface.sequelize.query(
            `CREATE TYPE enum_journal_entry_lines_type AS ENUM ('debit', 'credit')`,
            { transaction }
          );
          console.log('   ✅ Created enum_journal_entry_lines_type');
        }

        // Create journal_entry_lines table
        await queryInterface.createTable('journal_entry_lines', {
          id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true
          },
          journal_entry_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: {
              model: 'journal_entries',
              key: 'id'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          account_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: {
              model: 'accounts',
              key: 'id'
            },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          account_type_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: {
              model: 'account_types',
              key: 'id'
            },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE'
          },
          type: {
            type: Sequelize.DataTypes.ENUM('debit', 'credit'),
            allowNull: false
          },
          amount: {
            type: Sequelize.DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0.00
          },
          original_amount: {
            type: Sequelize.DataTypes.DECIMAL(15, 2),
            allowNull: true
          },
          equivalent_amount: {
            type: Sequelize.DataTypes.DECIMAL(24, 4),
            allowNull: true,
            defaultValue: 0
          },
          currency_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: {
              model: 'currencies',
              key: 'id'
            },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE'
          },
          exchange_rate_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: {
              model: 'exchange_rates',
              key: 'id'
            },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE'
          },
          exchange_rate: {
            type: Sequelize.DataTypes.DECIMAL(15, 6),
            allowNull: true,
            defaultValue: 1.000000
          },
          description: {
            type: Sequelize.DataTypes.TEXT,
            allowNull: true
          },
          line_number: {
            type: Sequelize.DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1
          },
          companyId: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: {
             model: 'company',
              key: 'id'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          created_at: {
            type: Sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          },
          updated_at: {
            type: Sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          }
        }, { transaction });

        console.log('   ✅ Created journal_entry_lines table');

        // Create indexes for journal_entry_lines
        await queryInterface.addIndex('journal_entry_lines', {
          fields: ['companyId'],
          name: 'journal_entry_lines_companyId_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entry_lines', {
          fields: ['journal_entry_id'],
          name: 'journal_entry_lines_journal_entry_id_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entry_lines', {
          fields: ['account_id'],
          name: 'journal_entry_lines_account_id_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entry_lines', {
          fields: ['account_type_id'],
          name: 'journal_entry_lines_account_type_id_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entry_lines', {
          fields: ['currency_id'],
          name: 'journal_entry_lines_currency_id_idx',
          transaction
        });

        await queryInterface.addIndex('journal_entry_lines', {
          fields: ['journal_entry_id', 'line_number'],
          name: 'journal_entry_lines_journal_entry_id_line_number_idx',
          transaction
        });

        console.log('   ✅ Created indexes for journal_entry_lines');
      } else {
        console.log('   ℹ️  journal_entry_lines table already exists, skipping');
      }

      await transaction.commit();
      console.log('✅ Migration completed successfully');
      
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Dropping Journal Entry tables...');
      
      // Drop journal_entry_lines first (due to foreign key)
      const linesTableExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables 
         WHERE table_schema = 'public' 
         AND table_name = 'journal_entry_lines'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (linesTableExists.length > 0) {
        await queryInterface.dropTable('journal_entry_lines', { transaction });
        console.log('   ✅ Dropped journal_entry_lines table');
      }

      // Drop journal_entries
      const tableExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables 
         WHERE table_schema = 'public' 
         AND table_name = 'journal_entries'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (tableExists.length > 0) {
        await queryInterface.dropTable('journal_entries', { transaction });
        console.log('   ✅ Dropped journal_entries table');
      }

      // Drop enum type
      const enumExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM pg_type WHERE typname = 'enum_journal_entry_lines_type'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (enumExists.length > 0) {
        await queryInterface.sequelize.query(
          `DROP TYPE IF EXISTS enum_journal_entry_lines_type`,
          { transaction }
        );
        console.log('   ✅ Dropped enum_journal_entry_lines_type');
      }

      await transaction.commit();
      console.log('✅ Rollback completed successfully');
      
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Rollback failed:', error.message);
      throw error;
    }
  }
};

