'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('conversations', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: {
        type: Sequelize.ENUM('group', 'private'),
        allowNull: false,
        comment: 'Chat shape: group vs one-to-one',
      },
      social_platform_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'social_platforms', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Which social platform this conversation came from',
      },
      is_continued: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
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

    await queryInterface.addIndex('conversations', ['business_id'], {
      name: 'idx_conversations_business',
    });

    // Inbox lookups always scope by business + platform.
    await queryInterface.addIndex('conversations', ['business_id', 'social_platform_id'], {
      name: 'idx_conversations_business_platform',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('conversations');
  },
};
