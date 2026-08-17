'use strict';

/**
 * Instagram Direct messages, inbound and outbound.
 * Mirrors whatsapp_messages so both platforms hang off the same
 * conversations table.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('instagram_messages', {
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
      to_igsid: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Instagram-scoped ID of the recipient (outbound)',
      },
      from_igsid: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Instagram-scoped ID of the sender (inbound)',
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
        type: Sequelize.ENUM('text', 'image', 'video', 'audio', 'file', 'share', 'story_reply', 'reaction'),
        allowNull: false,
        defaultValue: 'text',
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Full payload sent to / received from the Graph API',
      },

      // ── Meta tracking ────────────────────────────────────────────────────
      mid: {
        type: Sequelize.STRING(255),
        allowNull: true,
        unique: true,
        comment: "Instagram's message ID (mid) — used to de-duplicate deliveries",
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

    await queryInterface.addIndex('instagram_messages', ['mid'], {
      name: 'idx_instagram_messages_mid',
    });

    await queryInterface.addIndex('instagram_messages', ['conversation_id', 'status'], {
      name: 'idx_instagram_messages_conversation_status',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('instagram_messages');
  },
};
