'use strict';

/**
 * A business can connect several WhatsApp numbers, Facebook Pages and
 * Instagram accounts, so a conversation has to remember which one it runs
 * through: replies must leave from the number/Page the customer wrote to, and
 * one customer writing to two of our numbers is two separate threads.
 *
 * conversations.account_id is polymorphic on social_platform_id — it holds a
 * whatsapp_details / instagram_details / messenger_details id — so it carries
 * no foreign key.
 *
 * Templates belong to a WABA rather than a business, so whatsapp_templates
 * gains waba_id and its uniqueness moves to (business, waba, name).
 *
 * Existing rows are backfilled from the business's account on that platform
 * (active first), which is the account every one of them was sent through
 * while only one was supported.
 */
const PLATFORM_TABLES = {
  whatsapp: 'whatsapp_details',
  instagram: 'instagram_details',
  messenger: 'messenger_details',
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('conversations', 'account_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      after: 'social_platform_id',
      comment: 'Connected account this thread runs through — whatsapp_details / instagram_details / messenger_details id, by platform',
    });

    for (const [platform, table] of Object.entries(PLATFORM_TABLES)) {
      await queryInterface.sequelize.query(`
        UPDATE conversations c
        JOIN social_platforms sp ON sp.id = c.social_platform_id AND sp.name = :platform
        SET c.account_id = (
          SELECT d.id FROM ${table} d
          WHERE d.business_id = c.business_id
          ORDER BY d.is_active DESC, d.deleted_at IS NULL DESC, d.id
          LIMIT 1
        )
        WHERE c.account_id IS NULL
      `, { replacements: { platform } });
    }

    // New index first, so business_id's foreign key is never left without one.
    await queryInterface.addIndex(
      'conversations',
      ['business_id', 'social_platform_id', 'account_id', 'contact_identifier'],
      { name: 'idx_conversations_account_contact', unique: true }
    );
    await queryInterface.removeIndex('conversations', 'idx_conversations_contact');

    await queryInterface.addColumn('whatsapp_templates', 'waba_id', {
      type: Sequelize.STRING(64),
      allowNull: true,
      after: 'business_id',
      comment: 'WhatsApp Business Account the template lives in',
    });

    await queryInterface.sequelize.query(`
      UPDATE whatsapp_templates t
      SET t.waba_id = (
        SELECT d.waba_id FROM whatsapp_details d
        WHERE d.business_id = t.business_id
        ORDER BY d.is_active DESC, d.deleted_at IS NULL DESC, d.id
        LIMIT 1
      )
      WHERE t.waba_id IS NULL
    `);

    await queryInterface.addIndex('whatsapp_templates', ['business_id', 'waba_id', 'name'], {
      name: 'idx_whatsapp_templates_business_waba_name',
      unique: true,
    });
    await queryInterface.removeIndex('whatsapp_templates', 'idx_whatsapp_templates_business_name');
  },

  // Rolling back fails on the restored unique indexes if a business already
  // has the same contact on two accounts (or the same template name in two
  // WABAs) — those rows must be merged or removed by hand first.
  down: async (queryInterface) => {
    await queryInterface.removeIndex('whatsapp_templates', 'idx_whatsapp_templates_business_waba_name');
    await queryInterface.addIndex('whatsapp_templates', ['business_id', 'name'], {
      name: 'idx_whatsapp_templates_business_name',
      unique: true,
    });
    await queryInterface.removeColumn('whatsapp_templates', 'waba_id');

    await queryInterface.removeIndex('conversations', 'idx_conversations_account_contact');
    await queryInterface.addIndex(
      'conversations',
      ['business_id', 'social_platform_id', 'contact_identifier'],
      { name: 'idx_conversations_contact', unique: true }
    );
    await queryInterface.removeColumn('conversations', 'account_id');
  },
};
