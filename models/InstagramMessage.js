'use strict';

module.exports = (sequelize, DataTypes) => {
  const InstagramMessage = sequelize.define('InstagramMessage', {
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
    to_igsid: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    from_igsid: {
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
      type: DataTypes.ENUM('text', 'image', 'video', 'audio', 'file', 'share', 'story_reply', 'reaction'),
      allowNull: false,
      defaultValue: 'text',
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    // ── Meta tracking ──────────────────────────────────────────────────────────
    mid: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
      comment: "Instagram's message ID (mid) — used to de-duplicate deliveries",
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
    tableName: 'instagram_messages',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  InstagramMessage.associate = function (models) {
    if (models.Conversation) {
      InstagramMessage.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    }
    if (models.User) {
      InstagramMessage.belongsTo(models.User, { foreignKey: 'sender_id', as: 'sender' });
      InstagramMessage.belongsTo(models.User, { foreignKey: 'receiver_id', as: 'receiver' });
    }
  };

  return InstagramMessage;
};
