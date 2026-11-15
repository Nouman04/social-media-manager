'use strict';

/**
 * Pipeline: stages (kanban columns) and deals (cards).
 * Default stages are created per business on first use (pipelineService.ensureStages).
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

    await queryInterface.createTable('pipeline_stages', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      uuid,
      business_id: fk('businesses', { allowNull: false, onDelete: 'CASCADE' }),
      name: { type: Sequelize.STRING(60), allowNull: false },
      color: { type: Sequelize.STRING(9), allowNull: false, defaultValue: '#64748b' },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      type: { type: Sequelize.ENUM('open', 'won', 'lost'), allowNull: false, defaultValue: 'open' },
      ...ts,
    });
    await queryInterface.addIndex('pipeline_stages', ['business_id', 'position'], { name: 'idx_stages_business_position' });

    await queryInterface.createTable('deals', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      uuid,
      business_id: fk('businesses', { allowNull: false, onDelete: 'CASCADE' }),
      title: { type: Sequelize.STRING(255), allowNull: false },
      contact_id: fk('contacts'),
      conversation_id: fk('conversations'),
      stage_id: fk('pipeline_stages', { allowNull: false, onDelete: 'RESTRICT' }),
      value: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'usd' },
      owner_id: fk('users'),
      company: { type: Sequelize.STRING(255), allowNull: true },
      source_channel: { type: Sequelize.ENUM('whatsapp', 'instagram', 'messenger', 'manual'), allowNull: false, defaultValue: 'manual' },
      expected_close_date: { type: Sequelize.DATEONLY, allowNull: true },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM('open', 'won', 'lost'), allowNull: false, defaultValue: 'open' },
      lost_reason: { type: Sequelize.TEXT, allowNull: true },
      stage_entered_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      closed_at: { type: Sequelize.DATE, allowNull: true, comment: 'Set when the deal enters a won/lost stage' },
      created_by: fk('users'),
      ...ts,
    });
    await queryInterface.addIndex('deals', ['business_id', 'stage_id', 'position'], { name: 'idx_deals_board' });
    await queryInterface.addIndex('deals', ['business_id', 'status', 'closed_at'], { name: 'idx_deals_status' });

    await queryInterface.createTable('deal_tags', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      deal_id: fk('deals', { allowNull: false, onDelete: 'CASCADE' }),
      tag_id: fk('tags', { allowNull: false, onDelete: 'CASCADE' }),
      ...ts,
    });
    await queryInterface.addIndex('deal_tags', ['deal_id', 'tag_id'], { unique: true, name: 'uq_deal_tag' });

    await queryInterface.createTable('deal_activities', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      deal_id: fk('deals', { allowNull: false, onDelete: 'CASCADE' }),
      user_id: fk('users'),
      action: { type: Sequelize.STRING(30), allowNull: false, comment: 'created, updated, moved, note' },
      from_value: { type: Sequelize.JSON, allowNull: true },
      to_value: { type: Sequelize.JSON, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('deal_activities', ['deal_id', 'id'], { name: 'idx_deal_activity' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('deal_activities');
    await queryInterface.dropTable('deal_tags');
    await queryInterface.dropTable('deals');
    await queryInterface.dropTable('pipeline_stages');
  },
};
