'use strict';

/**
 * Instagram's native-login messaging API (graph.instagram.com) requires a
 * THIRD id for the same contact, separate from both ig_user_id and the
 * webhook-scoped id already handled by instagram_details.ig_scoped_id: a
 * conversation-scoped recipient id, only discoverable via GET
 * /{ig_user_id}/conversations, that POST /{ig_user_id}/messages actually
 * requires as `recipient.id`. The webhook-scoped contact_identifier this
 * table already stores is rejected by that endpoint outright.
 *
 * Nullable and Instagram-specific — WhatsApp/Messenger rows leave it null.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('conversations', 'ig_send_id', {
      type: Sequelize.STRING(64),
      allowNull: true,
      comment: 'Instagram conversation-scoped recipient id required by POST /{ig_user_id}/messages — distinct from contact_identifier',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('conversations', 'ig_send_id');
  },
};
