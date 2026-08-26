'use strict';

const whatsappService = require('../services/whatsappService');

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  1. VERIFY CREDENTIALS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /whatsapp/verify-credentials
   *
   * Query params:
   *   - phone_number_id  (required)
   *   - access_token     (required)
   */
  verifyCredentials: async (req, res) => {
    try {
      const { phone_number_id, access_token } = req.query;

      if (!phone_number_id || !access_token) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: [
            !phone_number_id && 'phone_number_id is required',
            !access_token    && 'access_token is required',
          ].filter(Boolean),
        });
      }

      const data = await whatsappService.verifyCredentials(phone_number_id, access_token);

      return res.status(200).json({
        success: true,
        message: 'Credentials verified successfully',
        data,
      });
    } catch (err) {
      console.error('[whatsappController.verifyCredentials] Error:', err?.response?.data || err.message);

      // Forward the Graph API error when available
      if (err?.response?.data) {
        return res.status(err.response.status || 400).json({
          success: false,
          message: 'WhatsApp API error',
          error: err.response.data,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: err.message,
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  2. GET BUSINESS PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /whatsapp/business-profile
   *
   * Query params:
   *   - phone_number_id  (required)
   *   - access_token     (required)
   */
  getBusinessProfile: async (req, res) => {
    try {
      const { phone_number_id, access_token } = req.query;

      if (!phone_number_id || !access_token) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: [
            !phone_number_id && 'phone_number_id is required',
            !access_token    && 'access_token is required',
          ].filter(Boolean),
        });
      }

      const data = await whatsappService.getBusinessProfile(phone_number_id, access_token);

      return res.status(200).json({
        success: true,
        message: 'Business profile fetched successfully',
        data,
      });
    } catch (err) {
      console.error('[whatsappController.getBusinessProfile] Error:', err?.response?.data || err.message);

      if (err?.response?.data) {
        return res.status(err.response.status || 400).json({
          success: false,
          message: 'WhatsApp API error',
          error: err.response.data,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: err.message,
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3. UPDATE BUSINESS PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /whatsapp/business-profile
   *
   * Query params:
   *   - phone_number_id  (required)
   *   - access_token     (required)
   *
   * Body (any combination of):
   *   - about
   *   - address
   *   - description
   *   - email
   *   - websites          (array of strings)
   *   - vertical
   *   - profile_picture_handle
   */
  updateProfile: async (req, res) => {
    try {
      const { phone_number_id, access_token } = req.query;

      if (!phone_number_id || !access_token) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: [
            !phone_number_id && 'phone_number_id is required',
            !access_token    && 'access_token is required',
          ].filter(Boolean),
        });
      }

      const allowedFields = [
        'about',
        'address',
        'description',
        'email',
        'websites',
        'vertical',
        'profile_picture_handle',
      ];

      // Filter the body to only allowed profile fields
      const profileData = Object.fromEntries(
        Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
      );

      if (Object.keys(profileData).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid profile fields provided to update',
          allowedFields,
        });
      }

      const data = await whatsappService.updateProfile(phone_number_id, access_token, profileData);

      return res.status(200).json({
        success: true,
        message: 'Business profile updated successfully',
        data,
      });
    } catch (err) {
      console.error('[whatsappController.updateProfile] Error:', err?.response?.data || err.message);

      if (err?.response?.data) {
        return res.status(err.response.status || 400).json({
          success: false,
          message: 'WhatsApp API error',
          error: err.response.data,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: err.message,
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3c. ADD WHATSAPP BUSINESS ACCOUNT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/whatsapp/account
   *
   * Connects a vendor's WhatsApp Business Account to their business.
   * Credentials are verified against the Graph API before being saved.
   *
   * Body:
   *   - business_id            {number} required — tenant ID
   *   - phone_number_id        {string} required — Meta Phone Number ID
   *   - waba_id                {string} required — WhatsApp Business Account ID
   *   - access_token           {string} required — permanent/system-user access token
   *   - display_phone_number   {string} optional — auto-fetched from Meta if omitted
   */
  addAccount: async (req, res) => {
    try {
      const { business_id, phone_number_id, waba_id, access_token, display_phone_number } = req.body;

      const missing = [];
      if (!business_id)     missing.push('business_id is required');
      if (!phone_number_id) missing.push('phone_number_id is required');
      if (!waba_id)          missing.push('waba_id is required');
      if (!access_token)    missing.push('access_token is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const account = await whatsappService.addAccount(business_id, {
        phone_number_id,
        waba_id,
        access_token,
        display_phone_number,
      });

      return res.status(201).json({
        success: true,
        message: 'WhatsApp business account connected successfully',
        account,
      });
    } catch (err) {
      console.error('[whatsappController.addAccount] Error:', err?.response?.data || err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError && { metaError: err.metaError }),
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  4. WEBHOOK — GET (Meta verification handshake)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/whatsapp/webhook
   *
   * Meta calls this once when you register / re-register the webhook URL.
   * Query params sent by Meta:
   *   hub.mode         - must equal 'subscribe'
   *   hub.verify_token - must match WHATSAPP_VERIFY_TOKEN in .env
   *   hub.challenge    - random string we must echo back with 200 OK
   */
  verifyWebhook: (req, res) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const result = whatsappService.verifyWebhookToken(mode, token, challenge);

    if (result.valid) {
      console.log('[whatsappController.verifyWebhook] Webhook verified successfully.');
      return res.status(200).send(result.challenge);
    }

    console.warn('[whatsappController.verifyWebhook] Webhook verification failed — invalid token or mode.');
    return res.status(403).json({
      success: false,
      message: 'Forbidden: invalid verify token or mode',
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  5. WEBHOOK — POST (inbound messages & status updates)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/whatsapp/webhook
   *
   * Meta posts real-time events here (messages, delivery receipts, etc.).
   * Rule: ALWAYS return 200 immediately — any non-2xx causes Meta to retry.
   *
   * Processing is done asynchronously after the response is flushed.
   */
  handleWebhook: (req, res) => {
    // Acknowledge receipt to Meta right away — do NOT await processing
    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;

    // Guard: only handle whatsapp_business_account events
    if (body?.object !== 'whatsapp_business_account') {
      console.warn('[whatsappController.handleWebhook] Ignored non-WBA object:', body?.object);
      return;
    }

    // Fire-and-forget — errors are caught internally and logged
    whatsappService.processWebhookEvent(body)
      .then((result) => {
        console.log('[whatsappController.handleWebhook] Processing result:', result);
      })
      .catch((err) => {
        console.error('[whatsappController.handleWebhook] Unhandled processing error:', err.message);
      });
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  6. SEND TEMPLATE MESSAGE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/whatsapp/send/template
   *
   * Body:
   *   - business_id    {number}  required — tenant ID
   *   - to             {string}  required — digits only with country code (e.g. 923001234567)
   *   - template_name  {string}  required — approved template name in Meta
   *   - language_code  {string}  optional — default 'en_US'
   *   - components     {Array}   optional — template component params
   *   - receiver_id    {number}  optional — system user this message is associated with
   */
  sendTemplate: async (req, res) => {
    try {
      const { business_id, to, template_name, language_code = 'en_US', components = [], receiver_id = null } = req.body;

      const missing = [];
      if (!business_id)   missing.push('business_id is required');
      if (!to)            missing.push('to is required');
      if (!template_name) missing.push('template_name is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await whatsappService.sendTemplateMessage(
        business_id, to, template_name, language_code, components, req.user?.id || null, receiver_id
      );

      return res.status(200).json({
        success: true,
        message: 'Template message sent successfully',
        wamid: record.wamid,
        status: record.status,
        messageRecord: record,
        metaResponse,
      });
    } catch (err) {
      console.error('[whatsappController.sendTemplate] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError  && { metaError:     err.metaError }),
        ...(err.record     && { messageRecord: err.record }),
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  7. SEND TEXT REPLY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/whatsapp/send/text
   *
   * Body:
   *   - business_id  {number}  required
   *   - to           {string}  required — digits only with country code
   *   - body         {string}  required — message text
   *   - preview_url  {boolean} optional — default false
   *   - receiver_id  {number}  optional — system user this message is associated with
   */
  sendText: async (req, res) => {
    try {
      const { business_id, to, body: messageBody, preview_url = false, receiver_id = null } = req.body;

      const missing = [];
      if (!business_id)  missing.push('business_id is required');
      if (!to)           missing.push('to is required');
      if (!messageBody)  missing.push('body is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await whatsappService.sendTextMessage(
        business_id, to, messageBody, preview_url, req.user?.id || null, receiver_id
      );

      return res.status(200).json({
        success: true,
        message: 'Text message sent successfully',
        wamid: record.wamid,
        status: record.status,
        messageRecord: record,
        metaResponse,
      });
    } catch (err) {
      console.error('[whatsappController.sendText] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError  && { metaError:     err.metaError }),
        ...(err.record     && { messageRecord: err.record }),
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  8. SEND MEDIA MESSAGE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/whatsapp/send/media
   *
   * Body:
   *   - business_id  {number}                            required
   *   - to           {string}                            required — digits only with country code
   *   - media_type   {'image'|'document'|'audio'|'video'} required
   *   - media_url    {string}                            required unless media_id — public URL
   *   - media_id     {string}                            required unless media_url — from POST /media
   *   - caption      {string}                            optional — image / document only
   *   - filename     {string}                            optional — document only
   *   - receiver_id  {number}                            optional — system user this message is associated with
   */
  sendMedia: async (req, res) => {
    try {
      const { business_id, to, media_type, media_url, media_id, caption = '', filename = '', receiver_id = null } = req.body;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!to)          missing.push('to is required');
      if (!media_type)  missing.push('media_type is required (image | document | audio | video)');
      if (!media_url && !media_id && !req.file) missing.push('provide a file upload, media_id, or media_url');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      // A raw file was attached: hand it to Meta first, then send by the id it
      // returns. Meta will not accept binary content on the message endpoint.
      let resolvedMediaId = media_id;
      let localUrl = null;
      if (req.file && !resolvedMediaId) {
        const uploaded = await whatsappService.uploadMedia(
          business_id, req.file.buffer, req.file.originalname, req.file.mimetype
        );
        resolvedMediaId = uploaded.id;

        // Meta only hands back an id, and fetching the bytes again later needs
        // the token — so keep a local copy now purely so the inbox can show it.
        try {
          const fs = require('fs');
          const path = require('path');
          const crypto = require('crypto');

          const dir = path.join(__dirname, '../public/uploads');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          const ext = path.extname(req.file.originalname) ||
            '.' + String(req.file.mimetype).split('/')[1];
          const name = resolvedMediaId + '_' + crypto.randomBytes(6).toString('hex') + ext;
          fs.writeFileSync(path.join(dir, name), req.file.buffer);
          localUrl = '/public/uploads/' + name;
        } catch (fsErr) {
          console.warn('[whatsappController.sendMedia] could not cache upload locally:', fsErr.message);
        }
      }

      const { record, metaResponse } = await whatsappService.sendMediaMessage(
        business_id, to, media_type, media_url, caption, filename || (req.file && req.file.originalname), req.user?.id || null, receiver_id, resolvedMediaId, localUrl
      );

      return res.status(200).json({
        success: true,
        message: `${media_type} message sent successfully`,
        media_id: resolvedMediaId || null,
        wamid: record.wamid,
        status: record.status,
        messageRecord: record,
        metaResponse,
      });
    } catch (err) {
      console.error('[whatsappController.sendMedia] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError  && { metaError:     err.metaError }),
        ...(err.record     && { messageRecord: err.record }),
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  8b. INBOX
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/whatsapp/conversations?business_id=&limit=&offset=
   * Thread list with a last-message preview.
   */
  getConversations: async (req, res) => {
    try {
      const { business_id, limit = 50, offset = 0 } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }
      const data = await whatsappService.getConversations(business_id, { limit, offset });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      console.error('[whatsappController.getConversations] Error:', err.message);
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/v1/whatsapp/messages?business_id=&conversation_id=|contact=&limit=&offset=
   * One thread's history. `contact` lets the UI open a chat for a number that
   * has no conversation yet.
   */
  getMessages: async (req, res) => {
    try {
      const { business_id, conversation_id, contact, limit = 100, offset = 0 } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is required'] });
      }
      const data = await whatsappService.getMessages(business_id, {
        conversationId: conversation_id || null,
        contact: contact || null,
        limit,
        offset,
      });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      console.error('[whatsappController.getMessages] Error:', err.message);
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  9. TEMPLATE MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/whatsapp/templates?business_id=&force_sync=
   * Fetch template list (from Meta API & DB cache).
   */
  getTemplates: async (req, res) => {
    try {
      const { business_id, force_sync } = req.query;

      if (!business_id) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: ['business_id is required'],
        });
      }

      const forceSync = force_sync === undefined || force_sync === 'true' || force_sync === true;
      const templates = await whatsappService.getTemplates(business_id, forceSync);

      return res.status(200).json({
        success: true,
        count: templates.length,
        templates,
      });
    } catch (err) {
      console.error('[whatsappController.getTemplates] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError && { metaError: err.metaError }),
      });
    }
  },

  /**
   * POST /api/v1/whatsapp/templates
   * Create a new message template at Meta and store locally.
   * Body: { business_id, name, category, language, components }
   */
  createTemplate: async (req, res) => {
    try {
      const { business_id, name, category, language = 'en_US', components } = req.body;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!name) missing.push('name is required');
      if (!category) missing.push('category is required');
      if (!components) missing.push('components array is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { template, metaResponse } = await whatsappService.createTemplate(business_id, {
        name,
        category,
        language,
        components,
      });

      return res.status(201).json({
        success: true,
        message: 'Template submitted successfully for Meta review',
        template,
        metaResponse,
      });
    } catch (err) {
      console.error('[whatsappController.createTemplate] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError && { metaError: err.metaError }),
      });
    }
  },

  /**
   * DELETE /api/v1/whatsapp/templates?business_id=&name=
   * Delete a template from Meta and local DB.
   */
  deleteTemplate: async (req, res) => {
    try {
      const { business_id, name } = req.query;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!name) missing.push('name is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const response = await whatsappService.deleteTemplate(business_id, name);

      return res.status(200).json({
        success: true,
        message: `Template "${name}" deleted successfully`,
        metaResponse: response,
      });
    } catch (err) {
      console.error('[whatsappController.deleteTemplate] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError && { metaError: err.metaError }),
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  10. ACCOUNT HEALTH & MONITORING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/whatsapp/health?business_id=
   * Fetch current quality score, limit tier, and account mode from Meta & save locally.
   */
  getAccountHealth: async (req, res) => {
    try {
      const { business_id } = req.query;

      if (!business_id) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: ['business_id is required'],
        });
      }

      const health = await whatsappService.getAccountHealth(business_id);

      return res.status(200).json({
        success: true,
        message: 'Account health details fetched successfully',
        health,
      });
    } catch (err) {
      console.error('[whatsappController.getAccountHealth] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError && { metaError: err.metaError }),
      });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  11. MEDIA HANDLING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/whatsapp/media
   * Upload a file to Meta servers to obtain a media_id.
   * Expects multipart/form-data with fields:
   *   - business_id (text)
   *   - file (binary)
   */
  uploadMedia: async (req, res) => {
    try {
      const { business_id } = req.body;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'business_id is required' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const result = await whatsappService.uploadMedia(
        business_id,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      return res.status(200).json({
        success: true,
        message: 'Media uploaded successfully to Meta',
        media_id: result.id,
        metaResponse: result,
      });
    } catch (err) {
      console.error('[whatsappController.uploadMedia] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError && { metaError: err.metaError }),
      });
    }
  },

  /**
   * GET /api/v1/whatsapp/media?business_id=&media_id=
   * Retrieve download URL, download the binary payload, and cache it locally.
   */
  downloadMedia: async (req, res) => {
    try {
      const { business_id, media_id } = req.query;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!media_id) missing.push('media_id is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const result = await whatsappService.downloadMedia(business_id, media_id);

      return res.status(200).json({
        success: true,
        message: 'Media downloaded successfully from Meta',
        downloadInfo: result,
      });
    } catch (err) {
      console.error('[whatsappController.downloadMedia] Error:', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.metaError && { metaError: err.metaError }),
      });
    }
  },
};

