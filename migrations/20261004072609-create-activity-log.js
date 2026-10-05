'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('activity_logs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT.UNSIGNED
      },
      log_name: {
        type: Sequelize.STRING(100),
        defaultValue: 'default'
      },
      description: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      subject_type: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      subject_id: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      causer_type: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      causer_id: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      properties: {
        type: Sequelize.JSON,
        allowNull: true
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true
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

    await queryInterface.addIndex('activity_logs', ['subject_type', 'subject_id'], { name: 'idx_subject' });
    await queryInterface.addIndex('activity_logs', ['causer_id'], { name: 'idx_causer' });
    await queryInterface.addIndex('activity_logs', ['log_name'], { name: 'idx_log_name' });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('activity_logs');
  }
};