'use strict';

/**
 * Lookup table for the social platforms the system supports.
 *
 * Timestamped 20260728160010 on purpose — it must run BEFORE
 * 20260729160001-create-conversations, which references it via
 * conversations.social_platform_id.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('social_platforms', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
        comment: 'Machine name of the platform (e.g. whatsapp, instagram)',
      },
      label: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Human-readable name shown in the UI',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // ── Timestamps ────────────────────────────────────────────────────────
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
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Seed the supported platforms here rather than in a seeder, so the
    // conversations table always has valid rows to point at right after
    // a fresh `db:migrate`.
    const now = new Date();
    await queryInterface.bulkInsert('social_platforms', [
      { name: 'whatsapp',  label: 'WhatsApp',  is_active: true, created_at: now, updated_at: now },
      { name: 'instagram', label: 'Instagram', is_active: true, created_at: now, updated_at: now },
      { name: 'tiktok',    label: 'TikTok',    is_active: true, created_at: now, updated_at: now },
      { name: 'messenger', label: 'Messenger', is_active: true, created_at: now, updated_at: now },
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('social_platforms');
  },
};
