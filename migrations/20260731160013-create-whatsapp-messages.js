'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('whatsapp_messages', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      // ── Conversation linkage ─────────────────────────────────────────────
      conversation_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'conversations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Which conversation this message belongs to',
      },

      // ── Parties ──────────────────────────────────────────────────────────
      direction: {
        type: Sequelize.ENUM('outbound', 'inbound'),
        allowNull: false,
        defaultValue: 'outbound',
      },
      to_number: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Destination phone number (outbound)',
      },
      from_number: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Sender phone number (inbound)',
      },

      // ── Message type & content ────────────────────────────────────────────
      message_type: {
        type: Sequelize.ENUM('template', 'text', 'image', 'document', 'audio', 'video'),
        allowNull: false,
      },

      // Raw payload stored for debugging / replay
      payload: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Full payload sent to / received from Meta API',
      },

      // ── Meta tracking ────────────────────────────────────────────────────
      wamid: {
        type: Sequelize.STRING(128),
        allowNull: true,
        unique: true,
        comment: "Meta's returned message ID (wamid) — used for delivery tracking",
      },

      // ── Delivery status ───────────────────────────────────────────────────
      status: {
        type: Sequelize.ENUM('queued', 'sent', 'delivered', 'read', 'failed'),
        allowNull: false,
        defaultValue: 'queued',
      },
      error_code: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Meta API error code on failure (e.g. 131047 = 24-hour window closed)',
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    // Index on wamid for fast webhook status-update lookups
    await queryInterface.addIndex('whatsapp_messages', ['wamid'], {
      name: 'idx_whatsapp_messages_wamid',
    });

    // Index on (conversation_id, status) for conversation inbox queries
    await queryInterface.addIndex('whatsapp_messages', ['conversation_id', 'status'], {
      name: 'idx_whatsapp_messages_conversation_status',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('whatsapp_messages');
  },
};
