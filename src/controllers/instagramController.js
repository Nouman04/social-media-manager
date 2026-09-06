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
   * Update the connected account — mainly to rotate an expiring token, or to
   * set ig_scoped_id once it's been observed on a real inbound webhook event.
   * Body: { business_id, page_id?, access_token?, is_active?, ig_scoped_id? }
   */
  updateAccount: async (req, res) => {
    try {
      const { business_id, page_id, access_token, is_active, ig_scoped_id } = req.body;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }

      const account = await instagramService.updateAccount(business_id, { page_id, access_token, is_active, ig_scoped_id });
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

  /**
   * PUT /api/v1/instagram/conversations/:id
   * Set ig_send_id — the conversation-scoped recipient id Meta's send
   * endpoint requires but never appears in inbound webhooks. Look it up via
   * GET /{ig_user_id}/conversations?fields=participants and match by
   * username, then set it here before replying to a new contact.
   * Body: { business_id, ig_send_id }
   */
  updateConversationSendId: async (req, res) => {
    try {
      const { id } = req.params;
      const { business_id, ig_send_id } = req.body;

      const missing = missingFields({ business_id, ig_send_id });
      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const conversation = await instagramService.updateConversationSendId(business_id, id, ig_send_id);
      return res.status(200).json({ success: true, message: 'ig_send_id updated', conversation });
    } catch (err) {
      return fail(res, err, 'updateConversationSendId');
    }
  },

  // Webhook verification/delivery is handled by the shared
  // /api/v1/meta/webhook endpoint (metaWebhookController) rather than here —
  // it calls instagramService.verifyWebhookToken / processWebhookEvent directly.
};
