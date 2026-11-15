'use strict';

/**
 * 1. businesses.uuid — public id used in admin URLs.
 * 2. subscription_histories — append-only log of every subscription change
 *    (who, when, from → to status, plan, request, details).
 * 3. subscriptions becomes ONE row per business: its current state.
 *    Existing extra rows are folded into the history and removed.
 *
 * History for data that existed before this migration is rebuilt from
 * subscription_requests (requested / approved / rejected / cancelled) and is
 * marked details.backfilled = true.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const q = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements });
    const select = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });

    // ── 1. businesses.uuid ──────────────────────────────────────────────────
    await queryInterface.addColumn('businesses', 'uuid', { type: Sequelize.CHAR(36), allowNull: true, after: 'id' });
    await q('UPDATE businesses SET uuid = UUID() WHERE uuid IS NULL');
    await queryInterface.changeColumn('businesses', 'uuid', { type: Sequelize.CHAR(36), allowNull: false });
    await queryInterface.addIndex('businesses', ['uuid'], { unique: true, name: 'uq_businesses_uuid' });

    // ── 2. subscription_histories ───────────────────────────────────────────
    await queryInterface.createTable('subscription_histories', {
      id: { type: Sequelize.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
      business_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'businesses', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      subscription_id: {
        type: Sequelize.BIGINT.UNSIGNED, allowNull: true,
        references: { model: 'subscriptions', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      subscription_request_id: {
        type: Sequelize.BIGINT.UNSIGNED, allowNull: true,
        references: { model: 'subscription_requests', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      action: {
        type: Sequelize.STRING(40), allowNull: false,
        comment: 'requested, request_updated, request_cancelled, approved, rejected, created, updated, cancelled, expired',
      },
      from_status: { type: Sequelize.STRING(20), allowNull: true },
      to_status: { type: Sequelize.STRING(20), allowNull: true },
      plan_id: {
        type: Sequelize.BIGINT.UNSIGNED, allowNull: true,
        references: { model: 'plans', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        comment: 'Plan the change is about (the requested / new plan)',
      },
      previous_plan_id: {
        type: Sequelize.BIGINT.UNSIGNED, allowNull: true,
        references: { model: 'plans', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      actor_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        comment: 'Who made the change; null = system (e.g. expiry job)',
      },
      details: { type: Sequelize.JSON, allowNull: true, comment: 'note, reason, period dates, ...' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('subscription_histories', ['business_id', 'id'], { name: 'idx_subhist_business' });

    // ── backfill history from requests ──────────────────────────────────────
    await q(`
      INSERT INTO subscription_histories (business_id, subscription_id, subscription_request_id, action, from_status, to_status, plan_id, actor_id, details, created_at)
      SELECT business_id, subscription_id, id, 'requested', NULL, 'pending', plan_id, requested_by,
             JSON_OBJECT('note', note, 'payment_reference', payment_reference, 'type', type, 'backfilled', true), created_at
      FROM subscription_requests`);
    await q(`
      INSERT INTO subscription_histories (business_id, subscription_id, subscription_request_id, action, from_status, to_status, plan_id, actor_id, details, created_at)
      SELECT business_id, subscription_id, id, status, 'pending', IF(status = 'approved', 'active', 'rejected'), plan_id, reviewed_by,
             JSON_OBJECT('admin_note', admin_note, 'reason', reject_reason, 'backfilled', true), COALESCE(reviewed_at, updated_at)
      FROM subscription_requests WHERE status IN ('approved', 'rejected')`);
    await q(`
      INSERT INTO subscription_histories (business_id, subscription_id, subscription_request_id, action, from_status, to_status, plan_id, actor_id, details, created_at)
      SELECT business_id, subscription_id, id, 'request_cancelled', 'pending', 'cancelled', plan_id, requested_by,
             JSON_OBJECT('backfilled', true), updated_at
      FROM subscription_requests WHERE status = 'cancelled'`);
    // Subscriptions made by hand (no request).
    await q(`
      INSERT INTO subscription_histories (business_id, subscription_id, action, from_status, to_status, plan_id, details, created_at)
      SELECT s.business_id, s.id, 'created', NULL, s.status, s.plan_id, JSON_OBJECT('backfilled', true), s.created_at
      FROM subscriptions s
      WHERE NOT EXISTS (SELECT 1 FROM subscription_requests r WHERE r.subscription_id = s.id)`);

    // ── 3. one subscription row per business ────────────────────────────────
    const businesses = await select('SELECT business_id FROM subscriptions GROUP BY business_id HAVING COUNT(*) > 1');
    for (const { business_id } of businesses) {
      // Keep the row that best describes the business now: active > pending > newest.
      const [keep] = await select(
        `SELECT id FROM subscriptions WHERE business_id = :business_id
         ORDER BY (status = 'active') DESC, (status = 'pending') DESC, id DESC LIMIT 1`,
        { business_id }
      );
      await q('UPDATE subscription_requests SET subscription_id = :keep WHERE business_id = :business_id', { keep: keep.id, business_id });
      await q('UPDATE subscription_histories SET subscription_id = :keep WHERE business_id = :business_id', { keep: keep.id, business_id });
      await q('DELETE FROM subscriptions WHERE business_id = :business_id AND id <> :keep', { keep: keep.id, business_id });
    }
    await queryInterface.addIndex('subscriptions', ['business_id'], { unique: true, name: 'uq_subscriptions_business' });
  },

  down: async (queryInterface) => {
    // Rows folded into the history in up() are not recreated.
    await queryInterface.removeIndex('subscriptions', 'uq_subscriptions_business');
    await queryInterface.dropTable('subscription_histories');
    await queryInterface.removeIndex('businesses', 'uq_businesses_uuid');
    await queryInterface.removeColumn('businesses', 'uuid');
  },
};
