'use strict';

/** subscriptions.uuid — public id used in URLs (GET / PUT /subscriptions/:uuid). */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('subscriptions', 'uuid', { type: Sequelize.CHAR(36), allowNull: true, after: 'id' });
    await queryInterface.sequelize.query('UPDATE subscriptions SET uuid = UUID() WHERE uuid IS NULL');
    await queryInterface.changeColumn('subscriptions', 'uuid', { type: Sequelize.CHAR(36), allowNull: false });
    await queryInterface.addIndex('subscriptions', ['uuid'], { unique: true, name: 'uq_subscriptions_uuid' });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('subscriptions', 'uq_subscriptions_uuid');
    await queryInterface.removeColumn('subscriptions', 'uuid');
  },
};
