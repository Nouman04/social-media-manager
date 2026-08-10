'use strict';

module.exports = (sequelize, DataTypes) => {
  const MessengerMessage = sequelize.define('MessengerMessage', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },

    // ── Conversation linkage ──────────────────────────────────────────────────
    conversation_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'conversations', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },

    // ── Parties ───────────────────────────────────────────────────────────────
    direction: {
      type: DataTypes.ENUM('outbound', 'inbound'),
      allowNull: false,
      defaultValue: 'outbound',
    },
    to_psid: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    from_psid: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },

    // ── Internal user linkage ────────────────────────────────────────────────
    sender_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    receiver_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },

    // ── Message type & content ─────────────────────────────────────────────────
    message_type: {
      type: DataTypes.ENUM('text', 'image', 'video', 'audio', 'file', 'template', 'quick_reply', 'postback', 'reaction'),
      allowNull: false,
      defaultValue: 'text',
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    // ── Send policy ───────────────────────────────────────────────────────────
    messaging_type: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: 'RESPONSE / UPDATE / MESSAGE_TAG — required by Meta on send',
    },
    message_tag: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Tag used to message outside the 24-hour window (e.g. HUMAN_AGENT)',
    },

    // ── Meta tracking ──────────────────────────────────────────────────────────
    mid: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
      comment: "Messenger's message ID (mid) — used to de-duplicate deliveries",
    },

    // ── Delivery status ────────────────────────────────────────────────────────
    status: {
      type: DataTypes.ENUM('queued', 'sent', 'delivered', 'read', 'failed'),
      allowNull: false,
      defaultValue: 'queued',
    },
    error_code: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'messenger_messages',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  MessengerMessage.associate = function (models) {
    if (models.Conversation) {
      MessengerMessage.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    }
    if (models.User) {
      MessengerMessage.belongsTo(models.User, { foreignKey: 'sender_id', as: 'sender' });
      MessengerMessage.belongsTo(models.User, { foreignKey: 'receiver_id', as: 'receiver' });
    }
  };

  return MessengerMessage;
};
