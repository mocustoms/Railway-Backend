"use strict";

// hasIndexOn = async (table, col) => {
//   const existingIndexes = await queryInterface.showIndex(table);
//   return existingIndexes.some(
//     (ix) =>
//       ix.fields && ix.fields.some((f) => f.attribute === col || f.name === col),
//   );
// };

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("return_out_items", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal("uuid_generate_v4()"),
        primaryKey: true,
      },
      return_out_id: { type: Sequelize.UUID, allowNull: false },
      product_id: { type: Sequelize.UUID, allowNull: false },
      quantity: {
        type: Sequelize.DECIMAL(18, 3),
        allowNull: false,
        defaultValue: 0,
      },
      unit_price: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      discount_percentage: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      discount_amount: { type: Sequelize.DECIMAL(18, 2), allowNull: true },
      tax_percentage: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      tax_amount: { type: Sequelize.DECIMAL(18, 2), allowNull: true },
      refund_amount: { type: Sequelize.DECIMAL(18, 2), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      line_total: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      companyId: { type: Sequelize.UUID, allowNull: false },
    });

    const existingIndexes = await queryInterface.showIndex('return_out_items');

    if(!existingIndexes.some(ix => ix.fields && ix.fields.some(f => f.attribute === 'return_out_id' || f.name === 'return_out_id'))) {
      await queryInterface.addIndex("return_out_items", ["return_out_id"]);
    }
    if(!existingIndexes.some(ix => ix.fields && ix.fields.some(f => f.attribute === 'product_id' || f.name === 'product_id'))) {
      await queryInterface.addIndex("return_out_items", ["product_id"]);
    }
    if(!existingIndexes.some(ix => ix.fields && ix.fields.some(f => f.attribute === 'companyId' || f.name === 'companyId'))) {
      await queryInterface.addIndex("return_out_items", ["companyId"]);
    }


    // if (!(await hasIndexOn("return_out_items", "return_out_id"))) {
    //   await queryInterface.addIndex("return_out_items", ["return_out_id"]);
    // }
    // if (!(await hasIndexOn("return_out_items", "product_id"))) {
    //   await queryInterface.addIndex("return_out_items", ["product_id"]);
    // }
    // if (!(await hasIndexOn("return_out_items", "companyId"))) {
    //   await queryInterface.addIndex("return_out_items", ["companyId"]);
    // }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("return_out_items");
  },
};
