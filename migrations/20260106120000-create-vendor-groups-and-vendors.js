'use strict';

/**
 * Create VendorGroups and Vendors tables
 *
 * Adds vendor_groups and vendors tables with necessary foreign keys and indexes
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      console.log('🔄 Creating vendor_groups and vendors tables...');

      // Check if vendor_groups table exists
      const vgExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'vendor_groups'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vgExists.length === 0) {
        await queryInterface.createTable('vendor_groups', {
          id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true
          },
          vendor_group_code: {
            type: Sequelize.DataTypes.STRING(30),
            allowNull: false
          },
          vendor_group_name: {
            type: Sequelize.DataTypes.STRING(100),
            allowNull: false
          },
          liablity_account_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'accounts', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          payable_account_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'accounts', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          companyId: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'company', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          description: {
            type: Sequelize.DataTypes.TEXT,
            allowNull: true
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

        // Indexes for vendor_groups
        await queryInterface.addIndex('vendor_groups', {
          fields: ['vendor_group_name'],
          unique: true,
          name: 'vendor_groups_vendor_group_name_key',
          transaction
        });

        await queryInterface.addIndex('vendor_groups', {
          fields: ['liablity_account_id'],
          unique: true,
          name: 'vendor_groups_liablity_account_id_key',
          transaction
        });

        await queryInterface.addIndex('vendor_groups', {
          fields: ['payable_account_id'],
          unique: true,
          name: 'vendor_groups_payable_account_id_key',
          transaction
        });

        await queryInterface.addIndex('vendor_groups', {
          fields: ['companyId'],
          unique: true,
          name: 'vendor_groups_company_id_key',
          transaction
        });

        console.log('   ✅ Created vendor_groups table and indexes');
      } else {
        console.log('   ℹ️  vendor_groups table already exists, skipping');
      }

      // Check if vendors table exists
      const vExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'vendors'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vExists.length === 0) {
        await queryInterface.createTable('vendors', {
          id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true
          },
          vendor_id: {
            type: Sequelize.DataTypes.STRING(30),
            allowNull: false
          },
          vendor_group_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'vendor_groups', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE'
          },
          full_name: {
            type: Sequelize.DataTypes.STRING(150),
            allowNull: false
          },
          address: {
            type: Sequelize.DataTypes.TEXT,
            allowNull: true
          },
          companyId: {
            type: Sequelize.DataTypes.UUID,
            allowNull: false,
            references: { model: 'company', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE'
          },
          default_payable_account_id: {
            type: Sequelize.DataTypes.UUID,
            allowNull: true,
            references: { model: 'accounts', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE'
          },
          fax: {
            type: Sequelize.DataTypes.STRING(50),
            allowNull: true
          },
          phone_number: {
            type: Sequelize.DataTypes.STRING(50),
            allowNull: true
          },
          email: {
            type: Sequelize.DataTypes.STRING(150),
            allowNull: true
          },
          website: {
            type: Sequelize.DataTypes.STRING(200),
            allowNull: true
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

        // Indexes for vendors
        await queryInterface.addIndex('vendors', {
          fields: ['vendor_id', 'companyId'],
          unique: true,
          name: 'vendors_vendor_id_company_id_key',
          transaction
        });

        await queryInterface.addIndex('vendors', {
          fields: ['vendor_group_id'],
          unique: true,
          name: 'vendors_vendor_group_id_key',
          transaction
        });

        await queryInterface.addIndex('vendors', {
          fields: ['companyId'],
          unique: true,
          name: 'vendors_company_id_key',
          transaction
        });

        console.log('   ✅ Created vendors table and indexes');
      } else {
        console.log('   ℹ️  vendors table already exists, skipping');
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
      console.log('🔄 Dropping vendors and vendor_groups tables...');

      // Drop vendors first
      const vendorsExists = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'vendors'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vendorsExists.length > 0) {
        await queryInterface.dropTable('vendors', { transaction });
        console.log('   ✅ Dropped vendors table');
      }

      // Drop vendor_groups
      const vgExistsDown = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'vendor_groups'`,
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
      );

      if (vgExistsDown.length > 0) {
        await queryInterface.dropTable('vendor_groups', { transaction });
        console.log('   ✅ Dropped vendor_groups table');
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
