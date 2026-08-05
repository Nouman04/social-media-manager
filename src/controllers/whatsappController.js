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
   */
  sendTemplate: async (req, res) => {
    try {
      const { business_id, to, template_name, language_code = 'en_US', components = [] } = req.body;

      const missing = [];
      if (!business_id)   missing.push('business_id is required');
      if (!to)            missing.push('to is required');
      if (!template_name) missing.push('template_name is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await whatsappService.sendTemplateMessage(
        business_id, to, template_name, language_code, components
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
   */
  sendText: async (req, res) => {
    try {
      const { business_id, to, body: messageBody, preview_url = false } = req.body;

      const missing = [];
      if (!business_id)  missing.push('business_id is required');
      if (!to)           missing.push('to is required');
      if (!messageBody)  missing.push('body is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await whatsappService.sendTextMessage(
        business_id, to, messageBody, preview_url
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
   *   - media_url    {string}                            required — publicly accessible URL
   *   - caption      {string}                            optional — image / document only
   *   - filename     {string}                            optional — document only
   */
  sendMedia: async (req, res) => {
    try {
      const { business_id, to, media_type, media_url, caption = '', filename = '' } = req.body;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!to)          missing.push('to is required');
      if (!media_type)  missing.push('media_type is required (image | document | audio | video)');
      if (!media_url)   missing.push('media_url is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const { record, metaResponse } = await whatsappService.sendMediaMessage(
        business_id, to, media_type, media_url, caption, filename
      );

      return res.status(200).json({
        success: true,
        message: `${media_type} message sent successfully`,
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

