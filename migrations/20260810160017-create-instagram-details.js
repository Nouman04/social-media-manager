'use strict';

/**
 * Per-tenant Instagram Professional account credentials.
 *
 * Instagram messaging runs through the Graph API against an Instagram
 * Professional account that is linked to a Facebook Page. The Page access
 * token is what authorises send/receive on that account.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('instagram_details', {
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
        comment: 'Which business/tenant owns this Instagram account',
      },

      // ── Meta / Instagram identifiers ─────────────────────────────────────
      ig_user_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Instagram Professional account ID — maps inbound webhooks to the right tenant',
      },
      page_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Facebook Page ID the Instagram account is linked to',
      },
      username: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Instagram @username, fetched from Meta on connect',
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

    await queryInterface.addIndex('instagram_details', ['business_id'], {
      name: 'idx_instagram_details_business',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('instagram_details');
  },
};
