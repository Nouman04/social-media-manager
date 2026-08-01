'use strict';

module.exports = (sequelize, DataTypes) => {
  const WhatsappMessage = sequelize.define('WhatsappMessage', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },

    // ── Tenant linkage ───────────────────────────────────────────────────────
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'businesses', key: 'id' },
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
    if (models.Business) {
      WhatsappMessage.belongsTo(models.Business, {
        foreignKey: 'business_id',
        as: 'business',
      });
    }
  };

  return WhatsappMessage;
};
