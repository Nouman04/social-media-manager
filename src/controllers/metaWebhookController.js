'use strict';

const instagramService = require('../services/instagramService');
const messengerService = require('../services/messengerService');

/**
 * Instagram and Messenger both go through Facebook Login for Business (a
 * Page as the connecting identity), and Meta delivers both to whichever
 * Callback URL each product's webhook subscription points at — nothing
 * requires those to be different URLs. Registering ONE endpoint here for
 * both avoids re-doing the same verify-handshake and fire-and-forget
 * dispatch logic twice, and means only one Callback URL/Verify Token pair to
 * manage across both products in the Meta App Dashboard.
 *
 * WhatsApp keeps its own separate webhook (see whatsappRoutes.js) rather
 * than joining this one.
 *
 * Routing is by the top-level `object` field Meta stamps on every payload:
 *   - 'instagram' -> Instagram
 *   - 'page'      -> Messenger
 */
const PROCESSORS = {
  instagram: { name: 'instagram', service: instagramService },
  page: { name: 'messenger', service: messengerService },
};

module.exports = {

  /**
   * GET /api/v1/meta/webhook
   *
   * Meta calls this once when the webhook URL is registered — the same
   * handshake regardless of which product's subscription triggered it, so a
   * single shared verify token clears it for both.
   */
  verifyWebhook: (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Both services already know how to check this token; either agreeing is
    // enough, since in practice they resolve to the same configured value
    // (see each service's verifyWebhookToken).
    const result = [instagramService, messengerService]
      .map((service) => service.verifyWebhookToken(mode, token, challenge))
      .find((r) => r.valid);

    if (result) {
      console.log('[metaWebhookController.verifyWebhook] Webhook verified successfully.');
      return res.status(200).send(result.challenge);
    }

    console.warn('[metaWebhookController.verifyWebhook] Verification failed — invalid token or mode.');
    return res.status(403).json({ success: false, message: 'Forbidden: invalid verify token or mode' });
  },

  /**
   * POST /api/v1/meta/webhook
   *
   * Real-time event delivery for Instagram and Messenger alike. Always
   * acknowledge with 200 immediately — any non-2xx makes Meta retry and
   * eventually disable the subscription. Processing happens after the
   * response is flushed, routed to whichever product's service matches the
   * payload's `object` field.
   */
  handleWebhook: (req, res) => {
    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;
    const processor = PROCESSORS[body?.object];

    if (!processor) {
      console.warn('[metaWebhookController.handleWebhook] Ignored unrecognized object:', body?.object);
      return;
    }

    processor.service.processWebhookEvent(body)
      .then((result) => {
        console.log(`[metaWebhookController.handleWebhook] Processing result (${processor.name}):`, result);
      })
      .catch((err) => {
        console.error(`[metaWebhookController.handleWebhook] Unhandled processing error (${processor.name}):`, err.message);
      });
  },
};
