'use strict';

/**
 * Manual plan approval: a business user requests a plan, a Super Admin
 * approves (which creates the subscription) or rejects it.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('subscription_requests', {
      id: { type: Sequelize.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
      business_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      requested_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      plan_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      type: { type: Sequelize.ENUM('new', 'change'), allowNull: false, defaultValue: 'new' },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      note: { type: Sequelize.TEXT, allowNull: true },
      payment_reference: { type: Sequelize.STRING(255), allowNull: true },
      receipt_url: { type: Sequelize.STRING(512), allowNull: true },
      admin_note: { type: Sequelize.TEXT, allowNull: true },
      reject_reason: { type: Sequelize.TEXT, allowNull: true },
      reviewed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reviewed_at: { type: Sequelize.DATE, allowNull: true },
      subscription_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'subscriptions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('subscription_requests', ['business_id', 'status'], { name: 'idx_subreq_business_status' });
    await queryInterface.addIndex('subscription_requests', ['status', 'created_at'], { name: 'idx_subreq_status_created' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('subscription_requests');
  },
};
