'use strict';

module.exports = (sequelize, DataTypes) => {
  const WhatsappMessage = sequelize.define('WhatsappMessage', {
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
    to_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    from_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    // ── Internal user linkage ────────────────────────────────────────────────
    sender_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'System user who sent this message (outbound) — null for inbound messages',
    },
    receiver_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'System user this message is addressed to (inbound) — null for outbound messages',
    },

    // ── Message type & content ─────────────────────────────────────────────────
    message_type: {
      type: DataTypes.ENUM('template', 'text', 'image', 'document', 'audio', 'video'),
      allowNull: false,
    },

    // Raw payload stored for debugging / replay
    payload: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    // ── Meta tracking ──────────────────────────────────────────────────────────
    wamid: {
      type: DataTypes.STRING(128),
      allowNull: true,
      unique: true,
      comment: "Meta's returned message ID — used to match delivery receipts",
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
    tableName: 'whatsapp_messages',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  WhatsappMessage.associate = function (models) {
    if (models.Conversation) {
      WhatsappMessage.belongsTo(models.Conversation, {
        foreignKey: 'conversation_id',
        as: 'conversation',
      });
    }
    if (models.User) {
      WhatsappMessage.belongsTo(models.User, { foreignKey: 'sender_id', as: 'sender' });
      WhatsappMessage.belongsTo(models.User, { foreignKey: 'receiver_id', as: 'receiver' });
    }
  };

  return WhatsappMessage;
};
