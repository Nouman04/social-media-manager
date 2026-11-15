'use strict';

const realtime = require('./realtime');

/**
 * Keep conversations.last_message_at / last_inbound_* current on every saved
 * message, whatever code path saved it (send APIs, webhooks, campaigns).
 * A new inbound message also reopens a resolved or snoozed conversation.
 *
 * Never throws: a failure here must not lose the message that was just saved.
 */
const register = (db) => {
  const { Conversation } = db;

  const touch = async (msg, options = {}) => {
    try {
      if (msg.message_type === 'reaction') return;
      const at = msg.created_at || new Date();
      const inbound = msg.direction === 'inbound';
      const where = { id: msg.conversation_id };
      const tx = { transaction: options.transaction };

      await Conversation.update(
        inbound ? { last_message_at: at, last_inbound_at: at, last_inbound_message_id: msg.id } : { last_message_at: at },
        { where, ...tx }
      );

      if (inbound) {
        const [reopened] = await Conversation.update(
          { status: 'open', snoozed_until: null },
          { where: { ...where, status: ['resolved', 'snoozed'] }, ...tx }
        );
        if (reopened) {
          const conv = await Conversation.findByPk(msg.conversation_id, { attributes: ['id', 'business_id', 'status', 'assigned_to'], ...tx });
          realtime.emitToBusiness(conv.business_id, 'conversation:updated', { id: conv.id, status: conv.status, assigned_to: conv.assigned_to });
        }
      }
    } catch (err) {
      console.warn(`[inboxHooks] could not update conversation ${msg.conversation_id}:`, err.message);
    }
  };

  ['WhatsappMessage', 'InstagramMessage', 'MessengerMessage'].forEach((name) => {
    if (db[name]) db[name].addHook('afterCreate', 'inboxTouch', touch);
  });
};

module.exports = { register };
