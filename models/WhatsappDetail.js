'use strict';

module.exports = (sequelize, DataTypes) => {
  const WhatsappDetail = sequelize.define('WhatsappDetail', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },

    // ── Tenant linkage ─────────────────────────────────────────────────────
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'businesses',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },

    // ── Meta / WhatsApp identifiers ─────────────────────────────────────────
    phone_number_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      comment: 'Meta Phone Number ID — used to map inbound webhooks to the right tenant',
    },
    waba_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'WhatsApp Business Account ID',
    },
    display_phone_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Normalized (digits-only) display phone number — used to match Meta phone_number_quality_update webhook events to a tenant',
    },

    // ── Auth ────────────────────────────────────────────────────────────────
    access_token: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Tenant access token for sending outbound replies',
    },

    // ── State ───────────────────────────────────────────────────────────────
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    quality_rating: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'GREEN',
    },
    messaging_limit_tier: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'TIER_1K',
    },
    account_status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'ACTIVE',
    },
  }, {
    tableName: 'whatsapp_details',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  WhatsappDetail.associate = function (models) {
    if (models.Business) {
      WhatsappDetail.belongsTo(models.Business, {
        foreignKey: 'business_id',
        as: 'business',
      });
    }
  };

  return WhatsappDetail;
};
