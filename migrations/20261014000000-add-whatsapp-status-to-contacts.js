'use strict';

/**
 * Whether a contact's number is actually on WhatsApp.
 *
 * Cloud API has no lookup for this, so it is learned from real traffic: an
 * inbound message or a delivered/read receipt proves the number (valid), and
 * Meta's error 131026 "message undeliverable" marks it invalid.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('contacts', 'whatsapp_status', {
      type: Sequelize.ENUM('unknown', 'valid', 'invalid'),
      allowNull: false,
      defaultValue: 'unknown',
      after: 'phone',
      comment: 'Learned from message results — valid = reached on WhatsApp, invalid = Meta error 131026',
    });
    await queryInterface.addColumn('contacts', 'whatsapp_checked_at', {
      type: Sequelize.DATE,
      allowNull: true,
      after: 'whatsapp_status',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('contacts', 'whatsapp_checked_at');
    await queryInterface.removeColumn('contacts', 'whatsapp_status');
  },
};
