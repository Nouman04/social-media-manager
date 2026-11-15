'use strict';

/**
 * Tickets: support requests with an SLA, a readable number per business
 * (TKT-1001, …), categories, SLA policies (one per priority) and a timeline.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') },
    };
    const fk = (model, { allowNull = true, onDelete = 'SET NULL' } = {}) => ({
      type: Sequelize.INTEGER, allowNull, references: { model, key: 'id' }, onUpdate: 'CASCADE', onDelete,
    });
    const uuid = { type: Sequelize.CHAR(36), allowNull: false, unique: true };
    const PRIORITY = Sequelize.ENUM('low', 'medium', 'high', 'urgent');

    await queryInterface.createTable('ticket_categories', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      uuid,
      business_id: fk('businesses', { allowNull: false, onDelete: 'CASCADE' }),
      name: { type: Sequelize.STRING(60), allowNull: false },
      ...ts,
    });
    await queryInterface.addIndex('ticket_categories', ['business_id', 'name'], { unique: true, name: 'uq_ticket_category_name' });

    await queryInterface.createTable('sla_policies', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      uuid,
      business_id: fk('businesses', { allowNull: false, onDelete: 'CASCADE' }),
      name: { type: Sequelize.STRING(60), allowNull: false },
      priority: { type: PRIORITY, allowNull: false },
      first_response_minutes: { type: Sequelize.INTEGER, allowNull: false },
      resolution_minutes: { type: Sequelize.INTEGER, allowNull: false },
      business_hours_only: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      ...ts,
    });
    // A new ticket picks its policy by priority, so one policy per priority.
    await queryInterface.addIndex('sla_policies', ['business_id', 'priority'], { unique: true, name: 'uq_sla_business_priority' });

    await queryInterface.createTable('tickets', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      uuid,
      business_id: fk('businesses', { allowNull: false, onDelete: 'CASCADE' }),
      seq: { type: Sequelize.INTEGER, allowNull: false, comment: 'Per-business counter behind `number`' },
      number: { type: Sequelize.STRING(20), allowNull: false, comment: 'Readable id, e.g. TKT-1001' },
      subject: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      contact_id: fk('contacts'),
      conversation_id: fk('conversations'),
      channel: { type: Sequelize.ENUM('whatsapp', 'instagram', 'messenger', 'email', 'manual'), allowNull: false, defaultValue: 'manual' },
      status: { type: Sequelize.ENUM('open', 'pending', 'on_hold', 'resolved', 'closed'), allowNull: false, defaultValue: 'open' },
      priority: { type: PRIORITY, allowNull: false, defaultValue: 'medium' },
      category_id: fk('ticket_categories'),
      assignee_id: fk('users'),
      sla_policy_id: fk('sla_policies'),
      first_response_due_at: { type: Sequelize.DATE, allowNull: true },
      resolution_due_at: { type: Sequelize.DATE, allowNull: true },
      first_responded_at: { type: Sequelize.DATE, allowNull: true },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      sla_status: { type: Sequelize.ENUM('on_track', 'at_risk', 'breached', 'met'), allowNull: true },
      csat_score: { type: Sequelize.TINYINT, allowNull: true },
      created_by: fk('users'),
      ...ts,
    });
    await queryInterface.addIndex('tickets', ['business_id', 'seq'], { unique: true, name: 'uq_ticket_business_seq' });
    await queryInterface.addIndex('tickets', ['business_id', 'status'], { name: 'idx_tickets_status' });
    await queryInterface.addIndex('tickets', ['status', 'sla_status'], { name: 'idx_tickets_sla' });

    await queryInterface.createTable('ticket_tags', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      ticket_id: fk('tickets', { allowNull: false, onDelete: 'CASCADE' }),
      tag_id: fk('tags', { allowNull: false, onDelete: 'CASCADE' }),
      ...ts,
    });
    await queryInterface.addIndex('ticket_tags', ['ticket_id', 'tag_id'], { unique: true, name: 'uq_ticket_tag' });

    await queryInterface.createTable('ticket_events', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      ticket_id: fk('tickets', { allowNull: false, onDelete: 'CASCADE' }),
      user_id: fk('users'),
      type: { type: Sequelize.STRING(30), allowNull: false, comment: 'created, note, status, priority, assigned, tags, category, updated, sla_breached' },
      body: { type: Sequelize.TEXT, allowNull: true },
      from_value: { type: Sequelize.JSON, allowNull: true },
      to_value: { type: Sequelize.JSON, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('ticket_events', ['ticket_id', 'id'], { name: 'idx_ticket_events' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('ticket_events');
    await queryInterface.dropTable('ticket_tags');
    await queryInterface.dropTable('tickets');
    await queryInterface.dropTable('sla_policies');
    await queryInterface.dropTable('ticket_categories');
  },
};
