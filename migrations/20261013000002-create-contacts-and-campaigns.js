'use strict';

/**
 * Contacts (imported or added by hand) and WhatsApp template campaigns sent
 * to them.
 *
 * A campaign is a paid, Meta-approved template send, so only contacts whose
 * whatsapp_consent is opted_in are ever messaged. campaign_recipients is the
 * frozen audience — one row per contact — linked to the whatsapp_messages
 * row the send produced, whose status the delivery webhooks keep current.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const timestamps = {
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    };

    await queryInterface.createTable('contacts', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(255), allowNull: true },
      phone: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'Digits only with country code, e.g. 923001234567 — the WhatsApp "to"',
      },
      email: { type: Sequelize.STRING(255), allowNull: true },
      tags: { type: Sequelize.JSON, allowNull: true, comment: 'Array of strings, used to pick campaign audiences' },
      whatsapp_consent: {
        type: Sequelize.ENUM('opted_in', 'opted_out', 'unknown'),
        allowNull: false,
        defaultValue: 'unknown',
        comment: 'Only opted_in contacts receive campaign messages',
      },
      consent_source: { type: Sequelize.STRING(50), allowNull: true, comment: 'import / manual' },
      consent_at: { type: Sequelize.DATE, allowNull: true },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      ...timestamps,
    });
    await queryInterface.addIndex('contacts', ['business_id', 'phone'], {
      name: 'idx_contacts_business_phone',
      unique: true,
    });

    await queryInterface.createTable('campaigns', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(255), allowNull: false },
      account_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'whatsapp_details', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'WhatsApp number the campaign sends from',
      },
      template_name: { type: Sequelize.STRING(512), allowNull: false },
      language: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'en_US' },
      variables: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Body {{1}}, {{2}}… values in order; "{{contact.name}}" etc. are filled per contact',
      },
      audience: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: '{ tags?: string[], contact_ids?: number[] } — empty means every opted-in contact',
      },
      status: {
        type: Sequelize.ENUM('draft', 'sending', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'draft',
      },
      recipients_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      started_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('campaigns', ['business_id'], { name: 'idx_campaigns_business' });

    await queryInterface.createTable('campaign_recipients', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      campaign_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'campaigns', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      contact_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'contacts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      phone: { type: Sequelize.STRING(20), allowNull: false },
      whatsapp_message_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'whatsapp_messages', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Delivered/read status lives on this message, updated by webhooks',
      },
      status: {
        type: Sequelize.ENUM('queued', 'sent', 'failed'),
        allowNull: false,
        defaultValue: 'queued',
      },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('campaign_recipients', ['campaign_id', 'contact_id'], {
      name: 'idx_campaign_recipients_unique',
      unique: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('campaign_recipients');
    await queryInterface.dropTable('campaigns');
    await queryInterface.dropTable('contacts');
  },
};
