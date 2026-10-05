'use strict';

module.exports = {
  up: async (queryInterface) => {
    const cols = await queryInterface.describeTable('permissions');
    if (!cols.business_id) return;
    const [fks] = await queryInterface.sequelize.query(
      "SELECT CONSTRAINT_NAME AS n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permissions' AND COLUMN_NAME = 'business_id' AND REFERENCED_TABLE_NAME IS NOT NULL"
    );
    for (const { n } of fks) await queryInterface.removeConstraint('permissions', n);
    await queryInterface.removeColumn('permissions', 'business_id');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('permissions', 'business_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'businesses', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },
};
