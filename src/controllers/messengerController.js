'use strict';

const messengerService = require('../services/messengerService');

/**
 * Shared error responder — forwards the service's statusCode and any
 * Graph API error detail attached to it.
 */
const fail = (res, err, context) => {
  console.error(`[messengerController.${context}] Error:`, err?.response?.data || err.message);
  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    ...(err.metaError && { metaError: err.metaError }),
    ...(err.record && { messageRecord: err.record }),
  });
};

/** Collect missing-required-field messages. */
const missingFields = (checks) =>
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => `${name} is required`);

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  1. VERIFY CREDENTIALS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/messenger/verify-credentials?page_id=&access_token=
   * Check a credential pair against the Graph API before connecting it.
   */
  verifyCredentials: async (req, res) => {
    try {
      const { page_id, access_token } = req.query;

      const missing = missingFields({ page_id, access_token });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await messengerService.verifyCredentials(page_id, access_token);
      return res.status(200).json({ success: true, message: 'Credentials verified successfully', data });
    } catch (err) {
      return fail(res, err, 'verifyCredentials');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  2. ACCOUNT MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/messenger/account
   * Connect a vendor's Facebook Page.
   * Body: { business_id, page_id, access_token }
   */
  addAccount: async (req, res) => {
    try {
      const { business_id, page_id, access_token } = req.body;

      const missing = missingFields({ business_id, page_id, access_token });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const account = await messengerService.addAccount(business_id, { page_id, access_token });
      return res.status(201).json({
        success: true,
        message: 'Facebook Page connected successfully',
        account,
      });
    } catch (err) {
      return fail(res, err, 'addAccount');
    }
  },

  /**
   * GET /api/v1/messenger/account?business_id=
   * Return the connected Page (access token withheld).
   */
  getAccount: async (req, res) => {
    try {
      const { business_id } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const account = await messengerService.getAccount(business_id);
      return res.status(200).json({ success: true, account });
    } catch (err) {
      return fail(res, err, 'getAccount');
    }
  },

  /**
   * PUT /api/v1/messenger/account
   * Update the connected Page — mainly to rotate an expiring token.
   * Body: { business_id, access_token?, is_active? }
   */
  updateAccount: async (req, res) => {
    try {
      const { business_id, access_token, is_active } = req.body;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const account = await messengerService.updateAccount(business_id, { access_token, is_active });
      return res.status(200).json({ success: true, message: 'Facebook Page updated successfully', account });
    } catch (err) {
      return fail(res, err, 'updateAccount');
    }
  },

  /**
   * DELETE /api/v1/messenger/account?business_id=
   * Disconnect the Page (soft delete — message history is preserved).
   */
  deleteAccount: async (req, res) => {
    try {
      const { business_id } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const result = await messengerService.deleteAccount(business_id);
      return res.status(200).json({ success: true, message: 'Facebook Page disconnected successfully', result });
    } catch (err) {
      return fail(res, err, 'deleteAccount');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3. PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/messenger/profile?business_id=
   * Fetch the connected Page's own profile from Meta.
   */
  getProfile: async (req, res) => {
    try {
      const { business_id } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const data = await messengerService.getProfile(business_id);
      return res.status(200).json({ success: true, message: 'Page profile fetched successfully', data });
    } catch (err) {
      return fail(res, err, 'getProfile');
    }
  },

  /**
   * GET /api/v1/messenger/contact-profile?business_id=&psid=
   * Fetch a contact's profile (name, avatar) by their Page-Scoped ID.
   */
  getContactProfile: async (req, res) => {
    try {
      const { business_id, psid } = req.query;

      const missing = missingFields({ business_id, psid });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await messengerService.getContactProfile(business_id, psid);
      return res.status(200).json({ success: true, message: 'Contact profile fetched successfully', data });
    } catch (err) {
      return fail(res, err, 'getContactProfile');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  4. OUTBOUND MESSAGING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/messenger/send/text
   * Body: { business_id, to, text, messaging_type?, message_tag?, receiver_id? }
   */
  sendText: async (req, res) => {
    try {
      const {
        business_id, to, text,
        messaging_type = 'RESPONSE', message_tag = null, receiver_id = null,
      } = req.body;

      const missing = missingFields({ business_id, to, text });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await messengerService.sendTextMessage(business_id, to, text, {
        messagingType: messaging_type,
        messageTag: message_tag,
        senderId: req.user?.id || null,
        receiverId: receiver_id,
      });

      return res.status(200).json({
        success: true,
        message: 'Text message sent successfully',
        mid: record.mid,
        status: record.status,
        messageRecord: record,
        metaResponse,
      });
    } catch (err) {
      return fail(res, err, 'sendText');
    }
  },

  /**
   * POST /api/v1/messenger/send/media
   * Body: { business_id, to, media_type, media_url, messaging_type?, message_tag?, receiver_id? }
   */
  sendMedia: async (req, res) => {
    try {
      const {
        business_id, to, media_type, media_url,
        messaging_type = 'RESPONSE', message_tag = null, receiver_id = null,
      } = req.body;

      const missing = missingFields({ business_id, to, media_type, media_url });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await messengerService.sendMediaMessage(business_id, to, media_type, media_url, {
        messagingType: messaging_type,
        messageTag: message_tag,
        senderId: req.user?.id || null,
        receiverId: receiver_id,
      });

      return res.status(200).json({
        success: true,
        message: `${media_type} message sent successfully`,
        mid: record.mid,
        status: record.status,
        messageRecord: record,
        metaResponse,
      });
    } catch (err) {
      return fail(res, err, 'sendMedia');
    }
  },

  /**
   * POST /api/v1/messenger/send/quick-replies
   * Body: { business_id, to, text, quick_replies: [{title, payload}], ... }
   */
  sendQuickReplies: async (req, res) => {
    try {
      const {
        business_id, to, text, quick_replies,
        messaging_type = 'RESPONSE', message_tag = null, receiver_id = null,
      } = req.body;

      const missing = missingFields({ business_id, to, text, quick_replies });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await messengerService.sendQuickReplies(business_id, to, text, quick_replies, {
        messagingType: messaging_type,
        messageTag: message_tag,
        senderId: req.user?.id || null,
        receiverId: receiver_id,
      });

      return res.status(200).json({
        success: true,
        message: 'Quick replies sent successfully',
        mid: record.mid,
        status: record.status,
        messageRecord: record,
        metaResponse,
      });
    } catch (err) {
      return fail(res, err, 'sendQuickReplies');
    }
  },

  /**
   * POST /api/v1/messenger/sender-action
   * Body: { business_id, to, sender_action } — mark_seen | typing_on | typing_off
   */
  sendSenderAction: async (req, res) => {
    try {
      const { business_id, to, sender_action } = req.body;

      const missing = missingFields({ business_id, to, sender_action });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await messengerService.sendSenderAction(business_id, to, sender_action);
      return res.status(200).json({ success: true, message: `Sender action "${sender_action}" sent`, data });
    } catch (err) {
      return fail(res, err, 'sendSenderAction');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  5. INBOX
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/messenger/conversations?business_id=&limit=&offset=
   * List Messenger threads with a last-message preview.
   */
  getConversations: async (req, res) => {
    try {
      const { business_id, limit = 50, offset = 0 } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const data = await messengerService.getConversations(business_id, { limit, offset });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'getConversations');
    }
  },

  /**
   * GET /api/v1/messenger/messages?business_id=&conversation_id=&limit=&offset=
   * Fetch one thread's message history, oldest first.
   */
  getMessages: async (req, res) => {
    try {
      const { business_id, conversation_id, limit = 50, offset = 0 } = req.query;

      const missing = missingFields({ business_id, conversation_id });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await messengerService.getMessages(business_id, conversation_id, { limit, offset });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'getMessages');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  6. WEBHOOKS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/messenger/webhook
   * Meta calls this once when the webhook URL is registered.
   */
  verifyWebhook: (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const result = messengerService.verifyWebhookToken(mode, token, challenge);

    if (result.valid) {
      console.log('[messengerController.verifyWebhook] Webhook verified successfully.');
      return res.status(200).send(result.challenge);
    }

    console.warn('[messengerController.verifyWebhook] Verification failed — invalid token or mode.');
    return res.status(403).json({ success: false, message: 'Forbidden: invalid verify token or mode' });
  },

  /**
   * POST /api/v1/messenger/webhook
   *
   * Meta posts Messenger messages and receipts here. Always acknowledge with
   * 200 immediately — any non-2xx makes Meta retry and eventually disable the
   * subscription. Processing happens after the response is flushed.
   */
  handleWebhook: (req, res) => {
    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;

    // Messenger webhooks arrive with object = "page".
    if (body?.object !== 'page') {
      console.warn('[messengerController.handleWebhook] Ignored non-page object:', body?.object);
      return;
    }

    messengerService.processWebhookEvent(body)
      .then((result) => {
        console.log('[messengerController.handleWebhook] Processing result:', result);
      })
      .catch((err) => {
        console.error('[messengerController.handleWebhook] Unhandled processing error:', err.message);
      });
  },
};
