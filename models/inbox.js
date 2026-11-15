'use strict';

/**
 * Unified Inbox support tables. models/index.js loads one model per file, so
 * this file defines the small ones and exports Tag; the others register
 * themselves on `sequelize.models` (ConversationRead, ConversationTag,
 * ConversationNote, ConversationActivity) and are re-exposed by index.js.
 */
module.exports = (sequelize, DataTypes) => {
  const opts = (tableName) => ({ tableName, timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

  const ConversationRead = sequelize.define('ConversationRead', {
    conversation_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    last_read_message_id: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_read_at: DataTypes.DATE,
  }, opts('conversation_reads'));

  const ConversationTag = sequelize.define('ConversationTag', {
    conversation_id: { type: DataTypes.INTEGER, allowNull: false },
    tag_id: { type: DataTypes.INTEGER, allowNull: false },
  }, opts('conversation_tags'));

  const ConversationNote = sequelize.define('ConversationNote', {
    conversation_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: DataTypes.INTEGER,
    text: { type: DataTypes.TEXT, allowNull: false },
    mentions: DataTypes.JSON,
  }, opts('conversation_notes'));

  const ConversationActivity = sequelize.define('ConversationActivity', {
    conversation_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: DataTypes.INTEGER,
    action: { type: DataTypes.STRING(30), allowNull: false },
    from_value: DataTypes.JSON,
    to_value: DataTypes.JSON,
  }, opts('conversation_activities'));

  const Tag = sequelize.define('Tag', {
    // Public id used in URLs (PUT / DELETE /api/v1/tags/:uuid).
    uuid: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, allowNull: false, unique: true },
    business_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(50), allowNull: false },
    color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#64748b' },
  }, opts('tags'));

  Tag.associate = (models) => {
    Tag.belongsToMany(models.Conversation, { through: ConversationTag, foreignKey: 'tag_id', otherKey: 'conversation_id', as: 'conversations' });
    models.Conversation.belongsToMany(Tag, { through: ConversationTag, foreignKey: 'conversation_id', otherKey: 'tag_id', as: 'tags' });
    ConversationNote.belongsTo(models.User, { foreignKey: 'user_id', as: 'author' });
    ConversationActivity.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return Tag;
};
