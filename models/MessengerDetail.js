'use strict';

module.exports = (sequelize, DataTypes) => {
  const MessengerDetail = sequelize.define('MessengerDetail', {
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

    // ── Meta identifiers ────────────────────────────────────────────────────
    page_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      comment: 'Facebook Page ID — maps inbound webhooks to the right tenant',
    },
    page_name: {
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
    tableName: 'messenger_details',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  });

  MessengerDetail.associate = function (models) {
    if (models.Business) {
      MessengerDetail.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
  };

  return MessengerDetail;
};
