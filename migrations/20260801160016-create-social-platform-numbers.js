'use strict';

/**
 * Pivot between social_numbers and social_platforms.
 *
 * Records that a given phone number has been verified on a given social
 * platform (i.e. the platform's account manager confirmed ownership).
 * Runs after 20260731160010-create-social-numbers, which it references.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('social_platform_numbers', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      social_number_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'social_numbers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      social_platform_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'social_platforms', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      is_verified: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Whether this number is verified on this platform',
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

    // One row per (number, platform) pair.
    await queryInterface.addIndex('social_platform_numbers', ['social_number_id', 'social_platform_id'], {
      name: 'idx_social_platform_numbers_unique',
      unique: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('social_platform_numbers');
  },
};
