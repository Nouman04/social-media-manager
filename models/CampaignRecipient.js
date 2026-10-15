'use strict';

module.exports = (sequelize, DataTypes) => {
  const CampaignRecipient = sequelize.define('CampaignRecipient', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    campaign_id: { type: DataTypes.INTEGER, allowNull: false },
    contact_id: { type: DataTypes.INTEGER, allowNull: true },
    phone: { type: DataTypes.STRING(20), allowNull: false },
    whatsapp_message_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Delivered/read status lives on this message, updated by webhooks',
    },
    status: {
      type: DataTypes.ENUM('queued', 'sent', 'failed'),
      allowNull: false,
      defaultValue: 'queued',
    },
    error_message: { type: DataTypes.TEXT, allowNull: true },
    sent_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'campaign_recipients',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  CampaignRecipient.associate = function (models) {
    if (models.Campaign) {
      CampaignRecipient.belongsTo(models.Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
    }
    if (models.Contact) {
      CampaignRecipient.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    }
    if (models.WhatsappMessage) {
      CampaignRecipient.belongsTo(models.WhatsappMessage, { foreignKey: 'whatsapp_message_id', as: 'message' });
    }
  };

  return CampaignRecipient;
};
