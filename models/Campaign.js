'use strict';

module.exports = (sequelize, DataTypes) => {
  const Campaign = sequelize.define('Campaign', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    business_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'businesses', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    name: { type: DataTypes.STRING(255), allowNull: false },
    account_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'whatsapp_details.id — the number the campaign sends from',
    },
    template_name: { type: DataTypes.STRING(512), allowNull: false },
    language: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'en_US' },
    variables: { type: DataTypes.JSON, allowNull: true },
    audience: { type: DataTypes.JSON, allowNull: true },
    status: {
      type: DataTypes.ENUM('draft', 'sending', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'draft',
    },
    recipients_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
    started_at: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'campaigns',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Campaign.associate = function (models) {
    if (models.Business) {
      Campaign.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
    if (models.WhatsappDetail) {
      Campaign.belongsTo(models.WhatsappDetail, { foreignKey: 'account_id', as: 'account' });
    }
    if (models.CampaignRecipient) {
      Campaign.hasMany(models.CampaignRecipient, { foreignKey: 'campaign_id', as: 'recipients' });
    }
  };

  return Campaign;
};
