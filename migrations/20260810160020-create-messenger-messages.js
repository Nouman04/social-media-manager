'use strict';

/**
 * Facebook Messenger messages, inbound and outbound.
 * Mirrors whatsapp_messages / instagram_messages so every platform hangs
 * off the same conversations table.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('messenger_messages', {
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
      to_psid: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Page-Scoped ID of the recipient (outbound)',
      },
      from_psid: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Page-Scoped ID of the sender (inbound)',
      },

      // ── Internal user linkage ────────────────────────────────────────────
      sender_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'System user (agent) who sent this message — null for inbound',
      },
      receiver_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'System user this message is addressed to — null for outbound',
      },

      // ── Message type & content ────────────────────────────────────────────
      message_type: {
        type: Sequelize.ENUM('text', 'image', 'video', 'audio', 'file', 'template', 'quick_reply', 'postback', 'reaction'),
        allowNull: false,
        defaultValue: 'text',
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Full payload sent to / received from the Graph API',
      },

      // ── Send policy ───────────────────────────────────────────────────────
      messaging_type: {
        type: Sequelize.STRING(32),
        allowNull: true,
        comment: 'RESPONSE / UPDATE / MESSAGE_TAG — required by Meta on send',
      },
      message_tag: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Tag used to message outside the 24-hour window (e.g. HUMAN_AGENT)',
      },

      // ── Meta tracking ────────────────────────────────────────────────────
      mid: {
        type: Sequelize.STRING(255),
        allowNull: true,
        unique: true,
        comment: "Messenger's message ID (mid) — used to de-duplicate deliveries",
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
        comment: 'Graph API error code on failure (e.g. 10 = outside 24h window)',
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

    await queryInterface.addIndex('messenger_messages', ['mid'], {
      name: 'idx_messenger_messages_mid',
    });

    await queryInterface.addIndex('messenger_messages', ['conversation_id', 'status'], {
      name: 'idx_messenger_messages_conversation_status',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('messenger_messages');
  },
};
