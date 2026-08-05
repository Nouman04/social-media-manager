'use strict';
module.exports = (sequelize, DataTypes) => {
  const ConversationParticipant = sequelize.define('ConversationParticipant', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    conversation_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'conversations',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    is_exit: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_removed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    removed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    is_notification_muted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    tableName: 'conversation_participants',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  ConversationParticipant.associate = function (models) {
    if (models.Conversation) {
      ConversationParticipant.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    }
    if (models.User) {
      ConversationParticipant.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
      ConversationParticipant.belongsTo(models.User, { foreignKey: 'removed_by', as: 'removedByUser' });
    }
  };

  return ConversationParticipant;
};
