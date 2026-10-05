'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('plan_features', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT.UNSIGNED
      },
      uuid: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        allowNull: false,
        unique: true
      },
      plan_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      feature_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'e.g. max_users, max_workspaces, ai_messages_per_month'
      },
      feature_value: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'e.g. 5, 10, unlimited'
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('plan_features', ['plan_id', 'feature_name'], {
      name: 'idx_plan_feature',
      unique: true
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('plan_features');
  }
};
