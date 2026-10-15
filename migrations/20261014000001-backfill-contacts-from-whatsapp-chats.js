'use strict';

/**
 * WhatsApp chat partners join the contact book automatically from now on
 * (whatsappService → recordWhatsappContact). This brings in everyone the
 * business chatted with before that existed.
 *
 * whatsapp_status follows the same rule as the live path: an inbound message
 * or a delivered/read outbound one proves the number (valid); otherwise a
 * 131026 failure marks it invalid; anything else stays unknown. Consent is
 * left unknown — chatting is not marketing opt-in.
 *
 * Existing contacts keep their data; only a still-unknown whatsapp_status and
 * a missing name are filled in.
 */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      INSERT INTO contacts
        (business_id, phone, name, whatsapp_status, whatsapp_checked_at, tags, whatsapp_consent, created_at, updated_at)
      SELECT business_id, phone, name, status,
             IF(status = 'unknown', NULL, last_message_at),
             JSON_ARRAY('whatsapp-inbox'), 'unknown', NOW(), NOW()
      FROM (
        SELECT
          c.business_id,
          c.contact_identifier AS phone,
          MAX(c.contact_name) AS name,
          CASE
            WHEN SUM(wm.direction = 'inbound' OR wm.status IN ('delivered', 'read')) > 0 THEN 'valid'
            WHEN SUM(wm.error_code = 131026) > 0 THEN 'invalid'
            ELSE 'unknown'
          END AS status,
          MAX(wm.updated_at) AS last_message_at
        FROM conversations c
        JOIN social_platforms sp ON sp.id = c.social_platform_id AND sp.name = 'whatsapp'
        LEFT JOIN whatsapp_messages wm ON wm.conversation_id = c.id AND wm.deleted_at IS NULL
        WHERE c.contact_identifier REGEXP '^[1-9][0-9]{6,14}$'
        GROUP BY c.business_id, c.contact_identifier
      ) AS chats
      ON DUPLICATE KEY UPDATE
        name = COALESCE(contacts.name, VALUES(name)),
        whatsapp_checked_at = IF(contacts.whatsapp_status = 'unknown' AND VALUES(whatsapp_status) <> 'unknown',
                                 VALUES(whatsapp_checked_at), contacts.whatsapp_checked_at),
        whatsapp_status = IF(contacts.whatsapp_status = 'unknown', VALUES(whatsapp_status), contacts.whatsapp_status)
    `);
  },

  // Backfilled contacts can't be told apart from ones added since — nothing
  // safe to undo.
  down: async () => {},
};
