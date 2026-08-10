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
  };

  return Conversation;
};
