'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('subscriptions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT.UNSIGNED
      },
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      plan_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      stripe_subscription_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
        comment: 'e.g. sub_1N123456'
      },
      stripe_status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'incomplete',
        comment: 'trialing, active, past_due, canceled, incomplete, incomplete_expired, unpaid'
      },
      trial_ends_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      current_period_start: {
        type: Sequelize.DATE,
        allowNull: true
      },
      current_period_end: {
        type: Sequelize.DATE,
        allowNull: true
      },
      ends_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Cancellation effective date (end of current period)'
      },
      canceled_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'When the user requested cancellation'
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

    await queryInterface.addIndex('subscriptions', ['business_id', 'stripe_status'], {
      name: 'idx_business_status'
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('subscriptions');
  }
};