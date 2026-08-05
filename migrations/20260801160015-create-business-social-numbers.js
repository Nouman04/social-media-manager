'use strict';

/**
 * Pivot table between business_socials and social_numbers.
 *
 * A business social can hold many social numbers; a social number is attached
 * to at most one business social — enforced by the unique index on
 * social_number_id.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('business_social_numbers', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      business_social_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'business_socials', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      social_number_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'social_numbers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
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
    });

    // A social number may only be synced to one business social.
    await queryInterface.addIndex('business_social_numbers', ['social_number_id'], {
      unique: true,
      name: 'idx_business_social_numbers_social_number',
    });

    await queryInterface.addIndex('business_social_numbers', ['business_social_id'], {
      name: 'idx_business_social_numbers_business_social',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('business_social_numbers');
  },
};
