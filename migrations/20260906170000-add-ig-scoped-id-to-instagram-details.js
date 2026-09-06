'use strict';

/**
 * Instagram reports two different identifiers for the same Professional
 * account: `ig_user_id` (the classic IG Business Account ID, obtained via
 * the Page-linking Graph API call and required as the URL prefix for
 * POST /{id}/messages) and a separate messaging-scoped ID that Meta's
 * current unified Instagram/Messenger system actually uses as `sender.id` /
 * `recipient.id` on every inbound webhook event.
 *
 * Matching inbound webhooks on `ig_user_id` alone silently drops every real
 * message, since that id never appears in the webhook payload — this column
 * lets processWebhookEvent match on either id.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('instagram_details', 'ig_scoped_id', {
      type: Sequelize.STRING(64),
      allowNull: true,
      unique: true,
      comment: 'Messaging-scoped Instagram ID — what actually appears as sender/recipient.id on inbound webhooks, distinct from ig_user_id',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('instagram_details', 'ig_scoped_id');
  },
};
