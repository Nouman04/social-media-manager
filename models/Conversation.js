'use strict';
module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define('Conversation', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
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
    type: {
      type: DataTypes.ENUM('group', 'private'),
      allowNull: false,
      comment: 'Chat shape: group vs one-to-one',
    },
    social_platform_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'social_platforms', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
      comment: 'Which social platform this conversation came from',
    },
    contact_identifier: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: 'External contact this thread is with (WhatsApp: phone; Instagram: scoped user id)',
    },
    contact_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Display name/username of the external contact, when the platform provides it',
    },
    ig_send_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Instagram conversation-scoped recipient id required by POST /{ig_user_id}/messages — distinct from contact_identifier',
    },
    is_continued: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  }, {
    tableName: 'conversations',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Conversation.associate = function (models) {
    if (models.Business) {
      Conversation.belongsTo(models.Business, { foreignKey: 'business_id', as: 'business' });
    }
    if (models.User) {
      Conversation.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
      Conversation.belongsToMany(models.User, {
        through: models.ConversationParticipant || 'conversation_participants',
        foreignKey: 'conversation_id',
        otherKey: 'user_id',
        as: 'participants',
      });
    }
    if (models.ConversationParticipant) {
      Conversation.hasMany(models.ConversationParticipant, { foreignKey: 'conversation_id', as: 'participantLinks' });
    }
    if (models.SocialPlatform) {
      Conversation.belongsTo(models.SocialPlatform, { foreignKey: 'social_platform_id', as: 'socialPlatform' });
    }
    if (models.WhatsappMessage) {
      Conversation.hasMany(models.WhatsappMessage, { foreignKey: 'conversation_id', as: 'whatsappMessages' });
    }
    if (models.InstagramMessage) {
      Conversation.hasMany(models.InstagramMessage, { foreignKey: 'conversation_id', as: 'instagramMessages' });
    }
    if (models.MessengerMessage) {
      Conversation.hasMany(models.MessengerMessage, { foreignKey: 'conversation_id', as: 'messengerMessages' });
    }
  };

  return Conversation;
};
