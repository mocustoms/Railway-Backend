"use strict";

// Migration: replace enum values for purchase_invoices.status
// New desired values: draft, sent, approved, paid, partial_paid, overdue, cancelled, rejected

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      // Create a new enum type with the desired values (if not exists)
      await queryInterface.sequelize.query(
        `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_purchase_invoices_status_new') THEN\n    CREATE TYPE "enum_purchase_invoices_status_new" AS ENUM ('draft','sent','approved','paid','partial_paid','overdue','cancelled','rejected');\n  END IF;\nEND$$;`,
        { transaction }
      );

      // Remove default first to avoid cast problems, then alter the column to use the new type (cast via text)
      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_invoices" ALTER COLUMN "status" DROP DEFAULT;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_invoices" ALTER COLUMN "status" TYPE enum_purchase_invoices_status_new USING status::text::enum_purchase_invoices_status_new;`,
        { transaction }
      );

      // Set a sensible default on the new enum type
      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_invoices" ALTER COLUMN "status" SET DEFAULT 'draft'::enum_purchase_invoices_status_new;`,
        { transaction }
      );

      // Drop the old enum type if it exists, then rename new to the expected name
      await queryInterface.sequelize.query(
        `DO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_purchase_invoices_status') THEN\n    DROP TYPE "enum_purchase_invoices_status";\n  END IF;\nEND$$;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TYPE enum_purchase_invoices_status_new RENAME TO enum_purchase_invoices_status;`,
        { transaction }
      );
    });
  },

  async down(queryInterface, Sequelize) {
    // Revert to previous enum values: draft, posted, partially_paid, paid, cancelled
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_purchase_invoices_status_old') THEN\n    CREATE TYPE "enum_purchase_invoices_status_old" AS ENUM ('draft','posted','partially_paid','paid','cancelled');\n  END IF;\nEND$$;`,
        { transaction }
      );

      // Remove default, alter back to the old type, then restore default and rename types
      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_invoices" ALTER COLUMN "status" DROP DEFAULT;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_invoices" ALTER COLUMN "status" TYPE enum_purchase_invoices_status_old USING status::text::enum_purchase_invoices_status_old;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_invoices" ALTER COLUMN "status" SET DEFAULT 'draft'::enum_purchase_invoices_status_old;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `DO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_purchase_invoices_status') THEN\n    DROP TYPE "enum_purchase_invoices_status";\n  END IF;\nEND$$;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TYPE enum_purchase_invoices_status_old RENAME TO enum_purchase_invoices_status;`,
        { transaction }
      );
    });
  },
};
