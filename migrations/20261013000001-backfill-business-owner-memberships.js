'use strict';

/**
 * POST /business used to create the business without the owner's
 * business_users row. Login builds the user's business list from that pivot,
 * so those owners saw "No business on this account" on every connect page.
 *
 * Adds the missing owner row for every business whose creator has no
 * membership at all. A soft-deleted membership counts as existing — that user
 * was removed on purpose, and the unique (business_id, user_id) index would
 * reject a second row anyway.
 */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      INSERT INTO business_users (business_id, user_id, is_owner, is_active, created_at, updated_at)
      SELECT b.id, b.created_by, true, true, NOW(), NOW()
      FROM businesses b
      WHERE NOT EXISTS (
        SELECT 1 FROM business_users bu
        WHERE bu.business_id = b.id AND bu.user_id = b.created_by
      )
    `);
  },

  // Backfilled rows are indistinguishable from real ones, so there is nothing
  // safe to undo.
  down: async () => {},
};
