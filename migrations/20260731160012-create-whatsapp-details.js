'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('whatsapp_details', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      // ── Tenant linkage ──────────────────────────────────────────────────
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Which business/tenant owns this WhatsApp number',
      },

      // ── Meta / WhatsApp identifiers ──────────────────────────────────────
      phone_number_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Meta Phone Number ID — used to map inbound webhooks to the right tenant',
      },
      waba_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'WhatsApp Business Account ID',
      },
      display_phone_number: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Normalized (digits-only) display phone number — used to match Meta phone_number_quality_update webhook events to a tenant',
      },

      // ── Auth ──────────────────────────────────────────────────────────────
      access_token: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Tenant access token used to send outbound replies',
      },

      // ── State ─────────────────────────────────────────────────────────────
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      quality_rating: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'GREEN / YELLOW / RED / UNKNOWN',
      },
      messaging_limit_tier: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'TIER_1K',
        comment: 'TIER_1K / TIER_10K / TIER_100K / UNLIMITED',
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
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('whatsapp_details');
  },
};
