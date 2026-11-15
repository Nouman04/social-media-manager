'use strict';

/**
 * Pipeline models. Exports PipelineStage; Deal, DealTag and DealActivity
 * register on sequelize.models (models/index.js picks them up).
 */
module.exports = (sequelize, DataTypes) => {
  const opts = (tableName) => ({ tableName, timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
  const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, allowNull: false, unique: true };

  const PipelineStage = sequelize.define('PipelineStage', {
    uuid,
    business_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(60), allowNull: false },
    color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#64748b' },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    type: { type: DataTypes.ENUM('open', 'won', 'lost'), allowNull: false, defaultValue: 'open' },
  }, opts('pipeline_stages'));

  const Deal = sequelize.define('Deal', {
    uuid,
    business_id: { type: DataTypes.INTEGER, allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    contact_id: DataTypes.INTEGER,
    conversation_id: DataTypes.INTEGER,
    stage_id: { type: DataTypes.INTEGER, allowNull: false },
    value: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'usd' },
    owner_id: DataTypes.INTEGER,
    company: DataTypes.STRING(255),
    source_channel: { type: DataTypes.ENUM('whatsapp', 'instagram', 'messenger', 'manual'), allowNull: false, defaultValue: 'manual' },
    expected_close_date: DataTypes.DATEONLY,
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('open', 'won', 'lost'), allowNull: false, defaultValue: 'open' },
    lost_reason: DataTypes.TEXT,
    stage_entered_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    closed_at: DataTypes.DATE,
    created_by: DataTypes.INTEGER,
  }, opts('deals'));

  const DealTag = sequelize.define('DealTag', {
    deal_id: { type: DataTypes.INTEGER, allowNull: false },
    tag_id: { type: DataTypes.INTEGER, allowNull: false },
  }, opts('deal_tags'));

  const DealActivity = sequelize.define('DealActivity', {
    deal_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: DataTypes.INTEGER,
    action: { type: DataTypes.STRING(30), allowNull: false },
    from_value: DataTypes.JSON,
    to_value: DataTypes.JSON,
  }, opts('deal_activities'));

  PipelineStage.associate = (models) => {
    PipelineStage.hasMany(Deal, { foreignKey: 'stage_id', as: 'deals' });
    Deal.belongsTo(PipelineStage, { foreignKey: 'stage_id', as: 'stage' });
    Deal.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    Deal.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    Deal.belongsTo(models.User, { foreignKey: 'owner_id', as: 'owner' });
    Deal.belongsToMany(models.Tag, { through: DealTag, foreignKey: 'deal_id', otherKey: 'tag_id', as: 'tags' });
    DealActivity.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return PipelineStage;
};
