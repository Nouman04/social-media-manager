'use strict';

/** tags.uuid — public id used in URLs (PUT / DELETE /api/v1/tags/:uuid). */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('tags', 'uuid', { type: Sequelize.CHAR(36), allowNull: true, after: 'id' });
    await queryInterface.sequelize.query('UPDATE tags SET uuid = UUID() WHERE uuid IS NULL');
    await queryInterface.changeColumn('tags', 'uuid', { type: Sequelize.CHAR(36), allowNull: false });
    await queryInterface.addIndex('tags', ['uuid'], { unique: true, name: 'uq_tags_uuid' });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('tags', 'uq_tags_uuid');
    await queryInterface.removeColumn('tags', 'uuid');
  },
};
