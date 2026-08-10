'use strict';

const instagramService = require('../services/instagramService');

/**
 * Shared error responder — forwards the service's statusCode and any
 * Graph API error detail attached to it.
 */
const fail = (res, err, context) => {
  console.error(`[instagramController.${context}] Error:`, err?.response?.data || err.message);
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
   * GET /api/v1/instagram/verify-credentials?ig_user_id=&access_token=
   * Check a credential pair against the Graph API before connecting it.
   */
  verifyCredentials: async (req, res) => {
    try {
      const { ig_user_id, access_token } = req.query;

      const missing = missingFields({ ig_user_id, access_token });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await instagramService.verifyCredentials(ig_user_id, access_token);
      return res.status(200).json({ success: true, message: 'Credentials verified successfully', data });
    } catch (err) {
      return fail(res, err, 'verifyCredentials');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  2. ACCOUNT MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/instagram/account
   * Connect a vendor's Instagram Professional account.
   * Body: { business_id, ig_user_id, page_id, access_token }
   */
  addAccount: async (req, res) => {
    try {
      const { business_id, ig_user_id, page_id, access_token } = req.body;

      const missing = missingFields({ business_id, ig_user_id, page_id, access_token });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const account = await instagramService.addAccount(business_id, { ig_user_id, page_id, access_token });
      return res.status(201).json({
        success: true,
        message: 'Instagram account connected successfully',
        account,
      });
    } catch (err) {
      return fail(res, err, 'addAccount');
    }
  },

  /**
   * GET /api/v1/instagram/account?business_id=
   * Return the connected account (access token withheld).
   */
  getAccount: async (req, res) => {
    try {
      const { business_id } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const account = await instagramService.getAccount(business_id);
      return res.status(200).json({ success: true, account });
    } catch (err) {
      return fail(res, err, 'getAccount');
    }
  },

  /**
   * PUT /api/v1/instagram/account
   * Update the connected account — mainly to rotate an expiring token.
   * Body: { business_id, page_id?, access_token?, is_active? }
   */
  updateAccount: async (req, res) => {
    try {
      const { business_id, page_id, access_token, is_active } = req.body;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const account = await instagramService.updateAccount(business_id, { page_id, access_token, is_active });
      return res.status(200).json({ success: true, message: 'Instagram account updated successfully', account });
    } catch (err) {
      return fail(res, err, 'updateAccount');
    }
  },

  /**
   * DELETE /api/v1/instagram/account?business_id=
   * Disconnect the account (soft delete — message history is preserved).
   */
  deleteAccount: async (req, res) => {
    try {
      const { business_id } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const result = await instagramService.deleteAccount(business_id);
      return res.status(200).json({ success: true, message: 'Instagram account disconnected successfully', result });
    } catch (err) {
      return fail(res, err, 'deleteAccount');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3. PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/instagram/profile?business_id=
   * Fetch the connected account's own Instagram profile from Meta.
   */
  getProfile: async (req, res) => {
    try {
      const { business_id } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const data = await instagramService.getProfile(business_id);
      return res.status(200).json({ success: true, message: 'Profile fetched successfully', data });
    } catch (err) {
      return fail(res, err, 'getProfile');
    }
  },

  /**
   * GET /api/v1/instagram/contact-profile?business_id=&igsid=
   * Fetch a contact's public profile (name, avatar) by their scoped ID.
   */
  getContactProfile: async (req, res) => {
    try {
      const { business_id, igsid } = req.query;

      const missing = missingFields({ business_id, igsid });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await instagramService.getContactProfile(business_id, igsid);
      return res.status(200).json({ success: true, message: 'Contact profile fetched successfully', data });
    } catch (err) {
      return fail(res, err, 'getContactProfile');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  4. OUTBOUND MESSAGING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/instagram/send/text
   * Body: { business_id, to, text, receiver_id? }
   */
  sendText: async (req, res) => {
    try {
      const { business_id, to, text, receiver_id = null } = req.body;

      const missing = missingFields({ business_id, to, text });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await instagramService.sendTextMessage(
        business_id, to, text, req.user?.id || null, receiver_id
      );

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
   * POST /api/v1/instagram/send/media
   * Body: { business_id, to, media_type, media_url, receiver_id? }
   */
  sendMedia: async (req, res) => {
    try {
      const { business_id, to, media_type, media_url, receiver_id = null } = req.body;

      const missing = missingFields({ business_id, to, media_type, media_url });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await instagramService.sendMediaMessage(
        business_id, to, media_type, media_url, req.user?.id || null, receiver_id
      );

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
   * POST /api/v1/instagram/send/reaction
   * Body: { business_id, to, message_id, reaction?, unreact? }
   */
  sendReaction: async (req, res) => {
    try {
      const { business_id, to, message_id, reaction = 'love', unreact = false } = req.body;

      const missing = missingFields({ business_id, to, message_id });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await instagramService.sendReaction(business_id, to, message_id, reaction, unreact);
      return res.status(200).json({
        success: true,
        message: unreact ? 'Reaction removed successfully' : 'Reaction sent successfully',
        data,
      });
    } catch (err) {
      return fail(res, err, 'sendReaction');
    }
  },

  /**
   * POST /api/v1/instagram/mark-seen
   * Body: { business_id, to }
   */
  markSeen: async (req, res) => {
    try {
      const { business_id, to } = req.body;

      const missing = missingFields({ business_id, to });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await instagramService.markSeen(business_id, to);
      return res.status(200).json({ success: true, message: 'Conversation marked as seen', data });
    } catch (err) {
      return fail(res, err, 'markSeen');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  5. INBOX
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/instagram/conversations?business_id=&limit=&offset=
   * List Instagram threads with a last-message preview.
   */
  getConversations: async (req, res) => {
    try {
      const { business_id, limit = 50, offset = 0 } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const data = await instagramService.getConversations(business_id, { limit, offset });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'getConversations');
    }
  },

  /**
   * GET /api/v1/instagram/messages?business_id=&conversation_id=&limit=&offset=
   * Fetch one thread's message history, oldest first.
   */
  getMessages: async (req, res) => {
    try {
      const { business_id, conversation_id, limit = 50, offset = 0 } = req.query;

      const missing = missingFields({ business_id, conversation_id });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const data = await instagramService.getMessages(business_id, conversation_id, { limit, offset });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'getMessages');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  6. WEBHOOKS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/instagram/webhook
   * Meta calls this once when the webhook URL is registered.
   */
  verifyWebhook: (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const result = instagramService.verifyWebhookToken(mode, token, challenge);

    if (result.valid) {
      console.log('[instagramController.verifyWebhook] Webhook verified successfully.');
      return res.status(200).send(result.challenge);
    }

    console.warn('[instagramController.verifyWebhook] Verification failed — invalid token or mode.');
    return res.status(403).json({ success: false, message: 'Forbidden: invalid verify token or mode' });
  },

  /**
   * POST /api/v1/instagram/webhook
   *
   * Meta posts Direct messages and receipts here. Always acknowledge with 200
   * immediately — any non-2xx makes Meta retry and eventually disable the
   * subscription. Processing happens after the response is flushed.
   */
  handleWebhook: (req, res) => {
    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;

    if (body?.object !== 'instagram') {
      console.warn('[instagramController.handleWebhook] Ignored non-instagram object:', body?.object);
      return;
    }

    instagramService.processWebhookEvent(body)
      .then((result) => {
        console.log('[instagramController.handleWebhook] Processing result:', result);
      })
      .catch((err) => {
        console.error('[instagramController.handleWebhook] Unhandled processing error:', err.message);
      });
  },
};
