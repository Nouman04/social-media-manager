'use strict';

/**
 * Ticket models. Exports Ticket; TicketCategory, SlaPolicy, TicketTag and
 * TicketEvent register on sequelize.models (models/index.js picks them up).
 */
module.exports = (sequelize, DataTypes) => {
  const opts = (tableName) => ({ tableName, timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
  const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, allowNull: false, unique: true };
  const PRIORITY = DataTypes.ENUM('low', 'medium', 'high', 'urgent');

  const TicketCategory = sequelize.define('TicketCategory', {
    uuid,
    business_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(60), allowNull: false },
  }, opts('ticket_categories'));

  const SlaPolicy = sequelize.define('SlaPolicy', {
    uuid,
    business_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(60), allowNull: false },
    priority: { type: PRIORITY, allowNull: false },
    first_response_minutes: { type: DataTypes.INTEGER, allowNull: false },
    resolution_minutes: { type: DataTypes.INTEGER, allowNull: false },
    business_hours_only: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, opts('sla_policies'));

  const Ticket = sequelize.define('Ticket', {
    uuid,
    business_id: { type: DataTypes.INTEGER, allowNull: false },
    seq: { type: DataTypes.INTEGER, allowNull: false },
    number: { type: DataTypes.STRING(20), allowNull: false },
    subject: { type: DataTypes.STRING(255), allowNull: false },
    description: DataTypes.TEXT,
    contact_id: DataTypes.INTEGER,
    conversation_id: DataTypes.INTEGER,
    channel: { type: DataTypes.ENUM('whatsapp', 'instagram', 'messenger', 'email', 'manual'), allowNull: false, defaultValue: 'manual' },
    status: { type: DataTypes.ENUM('open', 'pending', 'on_hold', 'resolved', 'closed'), allowNull: false, defaultValue: 'open' },
    priority: { type: PRIORITY, allowNull: false, defaultValue: 'medium' },
    category_id: DataTypes.INTEGER,
    assignee_id: DataTypes.INTEGER,
    sla_policy_id: DataTypes.INTEGER,
    first_response_due_at: DataTypes.DATE,
    resolution_due_at: DataTypes.DATE,
    first_responded_at: DataTypes.DATE,
    resolved_at: DataTypes.DATE,
    closed_at: DataTypes.DATE,
    sla_status: DataTypes.ENUM('on_track', 'at_risk', 'breached', 'met'),
    csat_score: DataTypes.TINYINT,
    created_by: DataTypes.INTEGER,
  }, opts('tickets'));

  const TicketTag = sequelize.define('TicketTag', {
    ticket_id: { type: DataTypes.INTEGER, allowNull: false },
    tag_id: { type: DataTypes.INTEGER, allowNull: false },
  }, opts('ticket_tags'));

  const TicketEvent = sequelize.define('TicketEvent', {
    ticket_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: DataTypes.INTEGER,
    type: { type: DataTypes.STRING(30), allowNull: false },
    body: DataTypes.TEXT,
    from_value: DataTypes.JSON,
    to_value: DataTypes.JSON,
  }, opts('ticket_events'));

  Ticket.associate = (models) => {
    Ticket.belongsTo(TicketCategory, { foreignKey: 'category_id', as: 'category' });
    Ticket.belongsTo(SlaPolicy, { foreignKey: 'sla_policy_id', as: 'sla_policy' });
    Ticket.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    Ticket.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    Ticket.belongsTo(models.User, { foreignKey: 'assignee_id', as: 'assignee' });
    Ticket.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Ticket.belongsToMany(models.Tag, { through: TicketTag, foreignKey: 'ticket_id', otherKey: 'tag_id', as: 'tags' });
    Ticket.hasMany(TicketEvent, { foreignKey: 'ticket_id', as: 'events' });
    TicketEvent.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return Ticket;
};
