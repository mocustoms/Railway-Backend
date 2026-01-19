"use strict";

// Migration: replace enum values for purchase_orders.status
// New desired values: draft, sent, accepted, rejected, expired, received, converted

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      // Create a new enum type with the desired values
      await queryInterface.sequelize.query(
        `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_purchase_orders_status_new') THEN\n    CREATE TYPE "enum_purchase_orders_status_new" AS ENUM ('draft','sent','accepted','rejected','expired','received','converted');\n  END IF;\nEND$$;`,
        { transaction }
      );

      // Remove default first (prevents cast errors), then alter the column to use the new type (cast via text)
      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_orders" ALTER COLUMN "status" DROP DEFAULT;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_orders" ALTER COLUMN "status" TYPE enum_purchase_orders_status_new USING status::text::enum_purchase_orders_status_new;`,
        { transaction }
      );

      // Set a sensible default on the new enum type
      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'draft'::enum_purchase_orders_status_new;`,
        { transaction }
      );

      // Drop the old enum type if it exists, then rename new to the expected name
      await queryInterface.sequelize.query(
        `DO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_purchase_orders_status') THEN\n    DROP TYPE "enum_purchase_orders_status";\n  END IF;\nEND$$;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TYPE enum_purchase_orders_status_new RENAME TO enum_purchase_orders_status;`,
        { transaction }
      );
    });
  },

  async down(queryInterface, Sequelize) {
    // Revert to previous enum values: draft, ordered, partially_received, received, cancelled
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_purchase_orders_status_old') THEN\n    CREATE TYPE "enum_purchase_orders_status_old" AS ENUM ('draft','ordered','partially_received','received','cancelled');\n  END IF;\nEND$$;`,
        { transaction }
      );

      // Remove default, alter back to the old type, then restore default and rename types
      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_orders" ALTER COLUMN "status" DROP DEFAULT;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_orders" ALTER COLUMN "status" TYPE enum_purchase_orders_status_old USING status::text::enum_purchase_orders_status_old;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'draft'::enum_purchase_orders_status_old;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `DO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_purchase_orders_status') THEN\n    DROP TYPE "enum_purchase_orders_status";\n  END IF;\nEND$$;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TYPE enum_purchase_orders_status_old RENAME TO enum_purchase_orders_status;`,
        { transaction }
      );
    });
  },
};
