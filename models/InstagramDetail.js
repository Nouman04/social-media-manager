'use strict';

module.exports = (sequelize, DataTypes) => {
  const InstagramDetail = sequelize.define('InstagramDetail', {
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
      references: { model: 'businesses', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },

    // ── Meta / Instagram identifiers ────────────────────────────────────────
    // Instagram exposes two different ids for the same Professional account:
    // ig_user_id is the classic IG Business Account ID — required as the URL
    // prefix for POST /{id}/messages when sending. ig_scoped_id is a separate
    // messaging-scoped id that Meta's current Instagram/Messenger system
    // actually reports as sender.id / recipient.id on inbound webhooks — that
    // one, not ig_user_id, is what maps an inbound event to the right tenant.
    ig_user_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      comment: 'Instagram Professional account ID — used as the URL prefix when sending messages',
    },
    ig_scoped_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      unique: true,
      comment: 'Messaging-scoped Instagram ID — what inbound webhooks report as sender/recipient.id',
    },
    page_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'Facebook Page ID the Instagram account is linked to',
    },
    username: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    // ── Auth ────────────────────────────────────────────────────────────────
    access_token: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Page access token used to send and read messages',
    },

    // ── State ───────────────────────────────────────────────────────────────
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    account_status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'ACTIVE',
    },
  }, {
    tableName: 'instagram_details',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  InstagramDetail.associate = function (models) {
    if (models.Business) {
      InstagramDetail.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
  };

  return InstagramDetail;
};
