'use strict';

/**
 * Per-tenant Facebook Messenger (Page) credentials.
 *
 * Messenger runs against a Facebook Page: the Page access token authorises
 * sending and receiving Direct messages on that Page's behalf.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('messenger_details', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      // ── Tenant linkage ───────────────────────────────────────────────────
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Which business/tenant owns this Facebook Page',
      },

      // ── Meta identifiers ─────────────────────────────────────────────────
      page_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Facebook Page ID — maps inbound webhooks to the right tenant',
      },
      page_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Page display name, fetched from Meta on connect',
      },

      // ── Auth ──────────────────────────────────────────────────────────────
      access_token: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Page access token used to send and read messages',
      },

      // ── State ─────────────────────────────────────────────────────────────
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      account_status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'ACTIVE',
        comment: 'ACTIVE / AT RISK / RESTRICTED',
      },

      // ── Timestamps ────────────────────────────────────────────────────────
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex('messenger_details', ['business_id'], {
      name: 'idx_messenger_details_business',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('messenger_details');
  },
};
