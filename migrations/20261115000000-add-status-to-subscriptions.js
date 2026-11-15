'use strict';

/**
 * Manual billing: subscriptions get their own lifecycle `status`, replacing
 * the Stripe-driven stripe_status (column kept, no longer written).
 *
 *   pending   → requested, waiting for Super Admin approval
 *   active    → approved / running
 *   cancelled → ended by the user or replaced by a newer plan
 *   expired   → ends_at passed
 *   rejected  → request rejected by the Super Admin
 *
 * Every subscription request now owns a subscription row from the start, so
 * the subscriptions table is the full history for a business.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('subscriptions', 'status', {
      type: Sequelize.ENUM('pending', 'active', 'cancelled', 'expired', 'rejected'),
      allowNull: false,
      defaultValue: 'pending',
      after: 'plan_id',
    });

    // Existing rows: map the old Stripe status.
    await queryInterface.sequelize.query(`
      UPDATE subscriptions SET status = CASE
        WHEN stripe_status IN ('active', 'trialing') THEN 'active'
        WHEN stripe_status IN ('canceled', 'cancelled') THEN 'cancelled'
        WHEN stripe_status = 'expired' THEN 'expired'
        ELSE 'pending'
      END`);

    // Requests that never got a subscription (pending / rejected / cancelled) get one now,
    // so the history is complete.
    await queryInterface.sequelize.query(`
      INSERT INTO subscriptions (business_id, plan_id, status, stripe_subscription_id, stripe_status, canceled_at, created_at, updated_at)
      SELECT r.business_id, r.plan_id,
             CASE r.status WHEN 'rejected' THEN 'rejected' WHEN 'cancelled' THEN 'cancelled' ELSE 'pending' END,
             CONCAT('manual_req_', r.id), 'incomplete',
             CASE WHEN r.status = 'cancelled' THEN r.updated_at ELSE NULL END,
             r.created_at, r.updated_at
      FROM subscription_requests r
      WHERE r.subscription_id IS NULL`);
    await queryInterface.sequelize.query(`
      UPDATE subscription_requests r
      JOIN subscriptions s ON s.stripe_subscription_id = CONCAT('manual_req_', r.id)
      SET r.subscription_id = s.id
      WHERE r.subscription_id IS NULL`);

    await queryInterface.addIndex('subscriptions', ['business_id', 'status'], { name: 'idx_subscriptions_business_status' });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('subscriptions', 'idx_subscriptions_business_status');
    // Rows created by up() for request history.
    await queryInterface.sequelize.query(`
      UPDATE subscription_requests r JOIN subscriptions s ON s.id = r.subscription_id
      SET r.subscription_id = NULL WHERE s.stripe_subscription_id LIKE 'manual\\_req\\_%'`);
    await queryInterface.sequelize.query("DELETE FROM subscriptions WHERE stripe_subscription_id LIKE 'manual\\_req\\_%'");
    await queryInterface.removeColumn('subscriptions', 'status');
  },
};
