'use strict';

/**
 * Unified Inbox: server-side ordering, status, assignment, per-user read
 * state, tags, internal notes and an activity trail for conversations.
 *
 * last_message_at / last_inbound_* are denormalised onto conversations so the
 * inbox can sort and keyset-paginate on an index instead of scanning three
 * message tables. A model hook keeps them current (src/helpers/inboxHooks.js).
 */
const MESSAGE_TABLES = ['whatsapp_messages', 'instagram_messages', 'messenger_messages'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    };
    const userFk = (allowNull = true) => ({
      type: Sequelize.INTEGER,
      allowNull,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: allowNull ? 'SET NULL' : 'CASCADE',
    });
    const conversationFk = {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'conversations', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    };

    // ── conversations: status, assignment, ordering ─────────────────────────
    await queryInterface.addColumn('conversations', 'status', {
      type: Sequelize.ENUM('open', 'pending', 'resolved', 'snoozed'),
      allowNull: false,
      defaultValue: 'open',
    });
    await queryInterface.addColumn('conversations', 'assigned_to', userFk());
    await queryInterface.addColumn('conversations', 'snoozed_until', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('conversations', 'last_message_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    });
    await queryInterface.addColumn('conversations', 'last_inbound_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('conversations', 'last_inbound_message_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'id in the channel message table of the latest inbound message — drives unread state',
    });

    // Backfill from existing messages; threads with none sort by creation time.
    await queryInterface.sequelize.query('UPDATE conversations SET last_message_at = created_at');
    for (const table of MESSAGE_TABLES) {
      await queryInterface.sequelize.query(`
        UPDATE conversations c
        JOIN (SELECT conversation_id, MAX(created_at) AS at FROM ${table}
              WHERE deleted_at IS NULL GROUP BY conversation_id) m ON m.conversation_id = c.id
        SET c.last_message_at = m.at`);
      await queryInterface.sequelize.query(`
        UPDATE conversations c
        JOIN (SELECT conversation_id, MAX(id) AS id, MAX(created_at) AS at FROM ${table}
              WHERE deleted_at IS NULL AND direction = 'inbound' GROUP BY conversation_id) m ON m.conversation_id = c.id
        SET c.last_inbound_message_id = m.id, c.last_inbound_at = m.at`);
    }

    await queryInterface.addIndex('conversations', ['business_id', 'last_message_at', 'id'], { name: 'idx_conv_inbox_order' });
    await queryInterface.addIndex('conversations', ['business_id', 'status'], { name: 'idx_conv_status' });
    await queryInterface.addIndex('conversations', ['status', 'snoozed_until'], { name: 'idx_conv_snooze' });

    // ── per-user read point ─────────────────────────────────────────────────
    await queryInterface.createTable('conversation_reads', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      conversation_id: conversationFk,
      user_id: userFk(false),
      last_read_message_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_read_at: { type: Sequelize.DATE, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('conversation_reads', ['conversation_id', 'user_id'], { unique: true, name: 'uq_conv_read_user' });
    await queryInterface.addIndex('conversation_reads', ['user_id'], { name: 'idx_conv_read_user' });

    // ── tags (shared by contacts, conversations, tickets, deals) ────────────
    await queryInterface.createTable('tags', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(50), allowNull: false },
      color: { type: Sequelize.STRING(9), allowNull: false, defaultValue: '#64748b' },
      ...ts,
    });
    await queryInterface.addIndex('tags', ['business_id', 'name'], { unique: true, name: 'uq_tags_business_name' });

    await queryInterface.createTable('conversation_tags', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      conversation_id: conversationFk,
      tag_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'tags', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ...ts,
    });
    await queryInterface.addIndex('conversation_tags', ['conversation_id', 'tag_id'], { unique: true, name: 'uq_conv_tag' });
    await queryInterface.addIndex('conversation_tags', ['tag_id'], { name: 'idx_conv_tag_tag' });

    // ── internal notes (never sent to the customer) ─────────────────────────
    await queryInterface.createTable('conversation_notes', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      conversation_id: conversationFk,
      user_id: userFk(),
      text: { type: Sequelize.TEXT, allowNull: false },
      mentions: { type: Sequelize.JSON, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('conversation_notes', ['conversation_id', 'id'], { name: 'idx_conv_notes' });

    // ── activity trail (assign / status / tags changes) ─────────────────────
    await queryInterface.createTable('conversation_activities', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      conversation_id: conversationFk,
      user_id: userFk(),
      action: { type: Sequelize.STRING(30), allowNull: false },
      from_value: { type: Sequelize.JSON, allowNull: true },
      to_value: { type: Sequelize.JSON, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('conversation_activities', ['conversation_id', 'id'], { name: 'idx_conv_activity' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('conversation_activities');
    await queryInterface.dropTable('conversation_notes');
    await queryInterface.dropTable('conversation_tags');
    await queryInterface.dropTable('tags');
    await queryInterface.dropTable('conversation_reads');
    await queryInterface.removeIndex('conversations', 'idx_conv_inbox_order');
    await queryInterface.removeIndex('conversations', 'idx_conv_status');
    await queryInterface.removeIndex('conversations', 'idx_conv_snooze');
    // assigned_to carries a FK; drop it before the column.
    const [fks] = await queryInterface.sequelize.query(`
      SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations'
        AND COLUMN_NAME = 'assigned_to' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    for (const fk of fks) await queryInterface.removeConstraint('conversations', fk.CONSTRAINT_NAME);
    for (const col of ['status', 'assigned_to', 'snoozed_until', 'last_message_at', 'last_inbound_at', 'last_inbound_message_id']) {
      await queryInterface.removeColumn('conversations', col);
    }
  },
};
