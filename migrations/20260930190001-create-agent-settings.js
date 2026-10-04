'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('agent_settings', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'One agent-settings record per business/tenant',
      },
      openrouter_api_key: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'User-supplied OpenRouter API key',
      },
      model: {
        type: Sequelize.STRING(120),
        allowNull: false,
        defaultValue: 'deepseek/deepseek-chat',
        comment: 'Full OpenRouter model ID e.g. anthropic/claude-3.5-sonnet',
      },
      system_prompt: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Custom system/persona prompt prepended to every chat',
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
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('agent_settings');
  },
};
