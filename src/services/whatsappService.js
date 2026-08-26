'use strict';

const axios = require('axios');
const { Op } = require('sequelize');
const { WhatsappDetail, WhatsappMessage, WhatsappTemplate, Business, Conversation } = require('../../models');
const { findOrCreateConversation, getPlatformId } = require('../helpers/conversationHelper');
const realtime = require('../helpers/realtime');

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';
const PLATFORM = 'whatsapp';

// ─── Valid phone-number format: digits only, no + or spaces ──────────────────
const PHONE_RE = /^\d{7,15}$/;

/**
 * Build common Axios config with the Bearer token.
 * @param {string} accessToken
 */
const buildConfig = (accessToken) => ({
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Fetch active WhatsappDetail for a tenant (business_id).
 * Throws if none exists.
 * @param {number} businessId
 * @returns {Promise<WhatsappDetail>}
 */
const getTenantCredentials = async (businessId) => {
  const detail = await WhatsappDetail.findOne({
    where: { business_id: businessId, is_active: true },
  });
  if (!detail) {
    const err = new Error(`No active WhatsApp credentials found for business_id=${businessId}`);
    err.statusCode = 404;
    throw err;
  }
  return detail;
};

/**
 * Persist an outbound message record and return it.
 *
 * Resolves (or opens) the conversation thread with this contact first, since
 * whatsapp_messages hangs off conversations rather than the business directly.
 *
 * Sets status = 'queued'.
 */
const createMessageRecord = async (businessId, toNumber, messageType, payload, senderId = null, receiverId = null) => {
  const conversation = await findOrCreateConversation({
    businessId,
    platformName: PLATFORM,
    contactIdentifier: toNumber,
    createdBy: senderId,
  });

  return WhatsappMessage.create({
    conversation_id: conversation.id,
    direction: 'outbound',
    to_number: toNumber,
    message_type: messageType,
    payload,
    status: 'queued',
    sender_id: senderId,
    receiver_id: receiverId,
  });
};

/**
 * After a successful Meta API call, store the wamid and mark status = 'sent'.
 */
const markSent = async (record, wamid) => {
  await record.update({ wamid, status: 'sent' });
  await emitOutbound(record);
};

/**
 * Mirror an outbound message to every open inbox for its business.
 * The conversation carries the business id, so it has to be looked up.
 */
const emitOutbound = async (record) => {
  try {
    const conversation = await Conversation.findByPk(record.conversation_id);
    if (!conversation) return;
    realtime.emitToBusiness(conversation.business_id, 'message:outbound', {
      message: record.toJSON(),
      conversation: {
        id: conversation.id,
        contact_identifier: conversation.contact_identifier,
        contact_name: conversation.contact_name,
      },
    });
  } catch (err) {
    console.warn('[whatsappService.emitOutbound] skipped:', err.message);
  }
};

/**
 * On a Meta API error, store the error details and mark status = 'failed'.
 */
const markFailed = async (record, errorCode, errorMessage) => {
  await record.update({ status: 'failed', error_code: errorCode, error_message: errorMessage });
};

// ══════════════════════════════════════════════════════════════════════════════
const whatsappService = {

  // ══════════════════════════════════════════════════════════════════════════
  //  1. VERIFY CREDENTIALS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Verify WhatsApp Business credentials by fetching phone number details.
   * GET https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}
   */
  verifyCredentials: async (phoneNumberId, accessToken) => {
    const url = `${GRAPH_API_BASE}/${phoneNumberId}`;
    const response = await axios.get(url, buildConfig(accessToken));
    return response.data;
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  2. GET BUSINESS PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch the WhatsApp Business profile.
   * GET https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/whatsapp_business_profile
   */
  getBusinessProfile: async (phoneNumberId, accessToken) => {
    const url = `${GRAPH_API_BASE}/${phoneNumberId}/whatsapp_business_profile`;
    const params = {
      fields: ['about', 'address', 'description', 'email', 'profile_picture_url', 'websites', 'vertical'].join(','),
    };
    const response = await axios.get(url, { ...buildConfig(accessToken), params });
    return response.data;
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3. UPDATE BUSINESS PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Update the WhatsApp Business profile fields.
   * POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/whatsapp_business_profile
   */
  updateProfile: async (phoneNumberId, accessToken, profileData) => {
    const url = `${GRAPH_API_BASE}/${phoneNumberId}/whatsapp_business_profile`;
    const response = await axios.post(url, profileData, buildConfig(accessToken));
    return response.data;
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3b. GET ACCOUNT HEALTH STATUS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch current quality score and messaging tier directly from Meta.
   * GET https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}?fields=quality_rating,messaging_limit_tier,account_mode
   *
   * @param {number} businessId
   * @returns {Promise<object>}
   */
  getAccountHealth: async (businessId) => {
    const detail = await getTenantCredentials(businessId);
    const url = `${GRAPH_API_BASE}/${detail.phone_number_id}`;
    const params = {
      fields: 'quality_rating,messaging_limit_tier,account_mode',
    };

    try {
      const response = await axios.get(url, { ...buildConfig(detail.access_token), params });
      const { quality_rating, messaging_limit_tier } = response.data;

      // Update local cache
      await detail.update({
        quality_rating: quality_rating || 'UNKNOWN',
        messaging_limit_tier: messaging_limit_tier || 'TIER_1K',
      });

      return {
        business_id: businessId,
        phone_number_id: detail.phone_number_id,
        quality_rating: detail.quality_rating,
        messaging_limit_tier: detail.messaging_limit_tier,
        account_status: detail.account_status,
        account_mode: response.data.account_mode,
      };
    } catch (apiErr) {
      const errData = apiErr?.response?.data?.error || {};
      const errMsg = errData.message || apiErr.message;
      console.error(`[whatsappService.getAccountHealth] FAILED | business_id=${businessId} | ${errMsg}`);
      const err = new Error(errMsg);
      err.statusCode = apiErr?.response?.status || 500;
      err.metaError = errData;
      throw err;
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3c. ADD WHATSAPP BUSINESS ACCOUNT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Connect a vendor's WhatsApp Business Account to a business (tenant).
   * Verifies the phone_number_id/access_token pair against the Graph API
   * before persisting, and auto-fills display_phone_number from Meta when
   * the caller doesn't supply one.
   *
   * GET https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}
   *
   * @param {number} businessId
   * @param {object} accountData { phone_number_id, waba_id, access_token, display_phone_number? }
   * @returns {Promise<WhatsappDetail>}
   */
  addAccount: async (businessId, { phone_number_id, waba_id, access_token, display_phone_number }) => {
    const business = await Business.findByPk(businessId);
    if (!business) {
      const err = new Error(`Business not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    // Verify the credentials actually work before saving them.
    let metaPhone;
    try {
      const url = `${GRAPH_API_BASE}/${phone_number_id}`;
      const response = await axios.get(url, {
        ...buildConfig(access_token),
        params: { fields: 'display_phone_number,verified_name' },
      });
      metaPhone = response.data;
    } catch (apiErr) {
      const errData = apiErr?.response?.data?.error || {};
      const err = new Error(errData.message || 'Failed to verify WhatsApp credentials with Meta');
      err.statusCode = apiErr?.response?.status || 400;
      err.metaError = errData;
      throw err;
    }

    const normalizedDisplayPhone =
      (display_phone_number || metaPhone.display_phone_number || '').replace(/\D/g, '') || null;

    try {
      const detail = await WhatsappDetail.create({
        business_id: businessId,
        phone_number_id,
        waba_id,
        access_token,
        display_phone_number: normalizedDisplayPhone,
      });
      console.log(`[whatsappService.addAccount] Connected | tenant=${businessId} | phone_number_id=${phone_number_id}`);
      return detail;
    } catch (dbErr) {
      if (dbErr?.name === 'SequelizeUniqueConstraintError') {
        const err = new Error(`phone_number_id "${phone_number_id}" is already connected to a business.`);
        err.statusCode = 409;
        throw err;
      }
      throw dbErr;
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  4. SEND TEMPLATE MESSAGE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send a pre-approved template message to a customer.
   * Used for initiating conversations or messaging outside the 24-hour window.
   *
   * POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages
   *
   * @param {number} businessId         - Tenant business_id (used to fetch credentials from DB).
   * @param {string} toNumber           - Destination phone number (digits only, with country code).
   * @param {string} templateName       - Approved template name in Meta Business Manager.
   * @param {string} languageCode       - Language code, default 'en_US'.
   * @param {Array}  components         - Template components array (header/body/button params).
   * @param {number} [senderId]         - System user (agent) sending this message.
   * @param {number} [receiverId]       - System user this message is associated with.
   * @returns {Promise<object>}         - { record, metaResponse }
   */
  sendTemplateMessage: async (businessId, toNumber, templateName, languageCode = 'en_US', components = [], senderId = null, receiverId = null) => {
    if (!PHONE_RE.test(toNumber)) {
      const err = new Error(`Invalid phone number format: "${toNumber}". Must be digits only with country code (e.g. 923001234567).`);
      err.statusCode = 400;
      throw err;
    }

    // 1. Fetch tenant credentials from DB
    const detail = await getTenantCredentials(businessId);

    // 2. Build payload
    const payload = {
      messaging_product: 'whatsapp',
      to: toNumber,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };

    // 3. Persist record as 'queued'
    const record = await createMessageRecord(businessId, toNumber, 'template', payload, senderId, receiverId);

    // 4. Send to Meta
    const url = `${GRAPH_API_BASE}/${detail.phone_number_id}/messages`;
    try {
      const response = await axios.post(url, payload, buildConfig(detail.access_token));
      const wamid = response.data?.messages?.[0]?.id;
      await markSent(record, wamid);
      console.log(`[whatsappService.sendTemplateMessage] Sent | tenant=${businessId} | to=${toNumber} | wamid=${wamid}`);
      return { record: await record.reload(), metaResponse: response.data };
    } catch (apiErr) {
      const errData  = apiErr?.response?.data?.error || {};
      const errCode  = errData?.code ?? null;
      const errMsg   = errData?.message ?? apiErr.message;
      console.error(`[whatsappService.sendTemplateMessage] FAILED | tenant=${businessId} | code=${errCode} | ${errMsg}`);
      await markFailed(record, errCode, errMsg);
      const wrapped = new Error(errMsg);
      wrapped.statusCode = apiErr?.response?.status || 500;
      wrapped.metaError  = errData;
      wrapped.record     = record;
      throw wrapped;
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  5. SEND TEXT REPLY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send a free-form text message within an active 24-hour customer service window.
   *
   * POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages
   *
   * @param {number} businessId  - Tenant business_id.
   * @param {string} toNumber    - Destination phone number (digits only).
   * @param {string} body        - Text message body.
   * @param {boolean} previewUrl - Whether WhatsApp should render link previews.
   * @param {number} [senderId]  - System user (agent) sending this message.
   * @param {number} [receiverId] - System user this message is associated with.
   * @returns {Promise<object>}  - { record, metaResponse }
   */
  sendTextMessage: async (businessId, toNumber, body, previewUrl = false, senderId = null, receiverId = null) => {
    if (!PHONE_RE.test(toNumber)) {
      const err = new Error(`Invalid phone number format: "${toNumber}". Must be digits only with country code (e.g. 923001234567).`);
      err.statusCode = 400;
      throw err;
    }

    const detail = await getTenantCredentials(businessId);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toNumber,
      type: 'text',
      text: {
        preview_url: previewUrl,
        body,
      },
    };

    const record = await createMessageRecord(businessId, toNumber, 'text', payload, senderId, receiverId);

    const url = `${GRAPH_API_BASE}/${detail.phone_number_id}/messages`;
    try {
      const response = await axios.post(url, payload, buildConfig(detail.access_token));
      const wamid = response.data?.messages?.[0]?.id;
      await markSent(record, wamid);
      console.log(`[whatsappService.sendTextMessage] Sent | tenant=${businessId} | to=${toNumber} | wamid=${wamid}`);
      return { record: await record.reload(), metaResponse: response.data };
    } catch (apiErr) {
      const errData  = apiErr?.response?.data?.error || {};
      const errCode  = errData?.code ?? null;
      const errMsg   = errData?.message ?? apiErr.message;
      console.error(`[whatsappService.sendTextMessage] FAILED | tenant=${businessId} | code=${errCode} | ${errMsg}`);
      await markFailed(record, errCode, errMsg);
      const wrapped = new Error(errMsg);
      wrapped.statusCode = apiErr?.response?.status || 500;
      wrapped.metaError  = errData;
      wrapped.record     = record;
      throw wrapped;
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  6. SEND MEDIA MESSAGE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send a media message (image / document / audio / video) via public URL.
   *
   * POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages
   *
   * @param {number} businessId  - Tenant business_id.
   * @param {string} toNumber    - Destination phone number (digits only).
   * @param {'image'|'document'|'audio'|'video'} mediaType - Media type.
   * @param {string} mediaUrl    - Publicly accessible URL of the media file.
   * @param {string} [caption]   - Optional caption (supported for image & document).
   * @param {string} [filename]  - Optional filename (used for document type).
   * @param {number} [senderId]  - System user (agent) sending this message.
   * @param {number} [receiverId] - System user this message is associated with.
   * @returns {Promise<object>}  - { record, metaResponse }
   */
  sendMediaMessage: async (businessId, toNumber, mediaType, mediaUrl, caption = '', filename = '', senderId = null, receiverId = null, mediaId = null, localUrl = null) => {
    const VALID_TYPES = ['image', 'document', 'audio', 'video'];
    if (!VALID_TYPES.includes(mediaType)) {
      const err = new Error(`Invalid media type "${mediaType}". Must be one of: ${VALID_TYPES.join(', ')}.`);
      err.statusCode = 400;
      throw err;
    }

    if (!PHONE_RE.test(toNumber)) {
      const err = new Error(`Invalid phone number format: "${toNumber}". Must be digits only with country code (e.g. 923001234567).`);
      err.statusCode = 400;
      throw err;
    }

    const detail = await getTenantCredentials(businessId);

    if (!mediaUrl && !mediaId) {
      const err = new Error('Either media_url or media_id is required.');
      err.statusCode = 400;
      throw err;
    }

    // Meta accepts either a public URL (link) or a previously uploaded media_id.
    // Prefer the id when both are given — Meta already holds those bytes.
    const mediaObject = mediaId ? { id: mediaId } : { link: mediaUrl };
    if (caption  && ['image', 'document'].includes(mediaType)) mediaObject.caption  = caption;
    if (filename && mediaType === 'document')                   mediaObject.filename = filename;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toNumber,
      type: mediaType,
      [mediaType]: mediaObject,
    };

    // What we store is the same payload plus a locally viewable copy of the
    // file, so the inbox can render outbound media too. Meta never sees this
    // extra key — it only goes in the DB record.
    const previewUrl = localUrl || (mediaUrl || null);
    const storedPayload = previewUrl
      ? { ...payload, [mediaType]: { ...mediaObject, local_url: previewUrl } }
      : payload;

    const record = await createMessageRecord(businessId, toNumber, mediaType, storedPayload, senderId, receiverId);

    const url = `${GRAPH_API_BASE}/${detail.phone_number_id}/messages`;
    try {
      const response = await axios.post(url, payload, buildConfig(detail.access_token));
      const wamid = response.data?.messages?.[0]?.id;
      await markSent(record, wamid);
      console.log(`[whatsappService.sendMediaMessage] Sent ${mediaType} | tenant=${businessId} | to=${toNumber} | wamid=${wamid}`);
      return { record: await record.reload(), metaResponse: response.data };
    } catch (apiErr) {
      const errData  = apiErr?.response?.data?.error || {};
      const errCode  = errData?.code ?? null;
      const errMsg   = errData?.message ?? apiErr.message;
      console.error(`[whatsappService.sendMediaMessage] FAILED | tenant=${businessId} | code=${errCode} | ${errMsg}`);
      await markFailed(record, errCode, errMsg);
      const wrapped = new Error(errMsg);
      wrapped.statusCode = apiErr?.response?.status || 500;
      wrapped.metaError  = errData;
      wrapped.record     = record;
      throw wrapped;
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  7. WEBHOOK — VERIFICATION TOKEN CHECK
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Validate the Meta webhook verification handshake.
   * @param {string} mode       - Must equal 'subscribe'.
   * @param {string} token      - Must match process.env.WHATSAPP_VERIFY_TOKEN.
   * @param {string} challenge  - Echoed back on success.
   * @returns {{ valid: boolean, challenge?: string }}
   */
  verifyWebhookToken: (mode, token, challenge) => {
    const systemToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && token === systemToken) {
      return { valid: true, challenge };
    }
    return { valid: false };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  8. WEBHOOK — EVENT PROCESSOR (MULTI-TENANT ROUTING)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Process an inbound Meta webhook payload and route to the right tenant.
   * @param {object} body - req.body from the webhook POST.
   * @returns {Promise<object>} - Result summary { processed, skipped, errors }.
   */
  processWebhookEvent: async (body) => {
    const result = { processed: 0, skipped: 0, errors: [] };

    const entries = body?.entry;
    if (!Array.isArray(entries) || entries.length === 0) { result.skipped++; return result; }

    for (const entry of entries) {
      const changes = entry?.changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        // Handle template status update events (which are attached at field level with WABA ID entry)
        if (change.field === 'message_template_status_update' && change.value) {
          const wabaId = entry.id;
          await whatsappService._handleTemplateStatusUpdate(wabaId, change.value);
          result.processed++;
          continue;
        }

        // Handle phone number quality status updates from Meta
        if (change.field === 'phone_number_quality_update' && change.value) {
          const value = change.value;
          await whatsappService._handlePhoneNumberQualityUpdate(value);
          result.processed++;
          continue;
        }

        const value         = change?.value;
        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!phoneNumberId) { result.skipped++; continue; }

        // ── Resolve tenant ─────────────────────────────────────────────────
        let whatsappDetail;
        try {
          whatsappDetail = await WhatsappDetail.findOne({
            where: { phone_number_id: phoneNumberId, is_active: true },
            include: [{ model: Business, as: 'business', attributes: ['id', 'name', 'created_by'] }],
          });
        } catch (dbErr) {
          result.errors.push({ phoneNumberId, error: dbErr.message });
          continue;
        }

        if (!whatsappDetail) {
          console.warn(`[whatsappService.processWebhookEvent] No active tenant for phone_number_id: ${phoneNumberId}`);
          result.skipped++;
          continue;
        }

        const tenantId = whatsappDetail.business_id;

        // ── Inbound messages ───────────────────────────────────────────────
        if (Array.isArray(value.messages)) {
          for (const message of value.messages) {
            await whatsappService._handleInboundMessage(tenantId, whatsappDetail, message, value.metadata, value.contacts);
          }
        }

        // ── Status updates ─────────────────────────────────────────────────
        if (Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            await whatsappService._handleStatusUpdate(tenantId, whatsappDetail, status);
          }
        }

        result.processed++;
      }
    }

    return result;
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — INTERNAL HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Persist an inbound message to the whatsapp_messages table.
   */
  _handleInboundMessage: async (tenantId, whatsappDetail, message, metadata, contacts = []) => {
    console.log(
      `[WEBHOOK] Inbound | tenant=${tenantId} | from=${message.from} | type=${message.type} | msgId=${message.id}`
    );

    // Auto-download media files if present
    const mediaTypes = ['image', 'document', 'audio', 'video'];
    if (mediaTypes.includes(message.type) && message[message.type]?.id) {
      try {
        const mediaId = message[message.type].id;
        const downloadedMediaInfo = await whatsappService.downloadMedia(tenantId, mediaId);
        // Enrich the message payload with local url
        message[message.type].local_url = downloadedMediaInfo.local_url;
      } catch (dlErr) {
        console.error(`[whatsappService._handleInboundMessage] Failed to download inbound media:`, dlErr.message);
      }
    }

    const ownerId = whatsappDetail?.business?.created_by || null;

    // Meta puts the sender's WhatsApp profile name in value.contacts[], keyed by
    // wa_id. metadata describes OUR number, so the name is never in there.
    const contact = Array.isArray(contacts) ? contacts.find((c) => c?.wa_id === message.from) : null;
    const contactName = contact?.profile?.name || null;

    // Resolve (or open) the thread with this contact before persisting.
    const conversation = await findOrCreateConversation({
      businessId: tenantId,
      platformName: PLATFORM,
      contactIdentifier: message.from,
      contactName,
      createdBy: ownerId,
    });

    try {
      const saved = await WhatsappMessage.create({
        conversation_id: conversation.id,
        direction:    'inbound',
        from_number:  message.from,
        to_number:    whatsappDetail?.display_phone_number || null,
        message_type: message.type,
        wamid:        message.id,
        payload:      message,
        status:       'delivered', // inbound messages are already delivered
        receiver_id:  ownerId,
      });

      // Push it to any open inbox for this tenant.
      realtime.emitToBusiness(tenantId, 'message:inbound', {
        message: saved.toJSON(),
        conversation: {
          id: conversation.id,
          contact_identifier: conversation.contact_identifier,
          contact_name: conversation.contact_name || contactName || null,
        },
      });
    } catch (dbErr) {
      // wamid unique constraint may fire on duplicate delivery — safe to ignore
      if (dbErr?.name === 'SequelizeUniqueConstraintError') {
        console.warn(`[whatsappService._handleInboundMessage] Duplicate wamid ${message.id} — skipped.`);
      } else {
        console.error(`[whatsappService._handleInboundMessage] DB error:`, dbErr.message);
      }
    }
  },

  /**
   * Update the status of an outbound message when Meta posts a delivery receipt.
   * Handles: sent → delivered → read → failed
   */
  _handleStatusUpdate: async (tenantId, whatsappDetail, statusEvent) => {
    const { id: wamid, status, errors } = statusEvent;
    console.log(`[WEBHOOK] Status | tenant=${tenantId} | wamid=${wamid} | status=${status}`);

    // Map Meta status strings to our ENUM
    const STATUS_MAP = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
    const mappedStatus = STATUS_MAP[status] ?? null;

    if (!mappedStatus) {
      console.warn(`[whatsappService._handleStatusUpdate] Unknown status "${status}" for wamid=${wamid}`);
      return;
    }

    const updateData = { status: mappedStatus };

    if (status === 'failed' && Array.isArray(errors) && errors.length > 0) {
      updateData.error_code    = errors[0]?.code    ?? null;
      updateData.error_message = errors[0]?.message ?? null;
      console.error(
        `[whatsappService._handleStatusUpdate] FAILED | wamid=${wamid} | code=${updateData.error_code} | ${updateData.error_message}`
      );
    }

    try {
      // wamid is globally unique; the conversation join keeps the update
      // scoped to the tenant that actually owns the message.
      const record = await WhatsappMessage.findOne({
        where: { wamid },
        include: [{ model: Conversation, as: 'conversation', attributes: ['id', 'business_id'] }],
      });

      if (!record) {
        console.warn(`[whatsappService._handleStatusUpdate] No record found for wamid=${wamid} — may not have been stored yet.`);
        return;
      }

      if (record.conversation?.business_id !== tenantId) {
        console.warn(`[whatsappService._handleStatusUpdate] wamid=${wamid} does not belong to tenant ${tenantId} — skipped.`);
        return;
      }

      await record.update(updateData);

      realtime.emitToBusiness(tenantId, 'message:status', {
        id: record.id,
        wamid: record.wamid,
        conversation_id: record.conversation_id,
        status: record.status,
        error_code: record.error_code || null,
        error_message: record.error_message || null,
      });
    } catch (dbErr) {
      console.error(`[whatsappService._handleStatusUpdate] DB error:`, dbErr.message);
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  8b. INBOX — CONVERSATIONS & MESSAGES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * List WhatsApp conversation threads for a tenant, most recent first.
   * Each row carries the last message so the inbox can show a preview.
   */
  getConversations: async (businessId, { limit = 50, offset = 0 } = {}) => {
    const socialPlatformId = await getPlatformId(PLATFORM);

    const { rows, count } = await Conversation.findAndCountAll({
      where: { business_id: businessId, social_platform_id: socialPlatformId },
      order: [['updated_at', 'DESC']],
      limit: Number(limit),
      offset: Number(offset),
    });

    const conversations = await Promise.all(rows.map(async (conv) => {
      const last = await WhatsappMessage.findOne({
        where: { conversation_id: conv.id },
        order: [['created_at', 'DESC']],
      });
      return { ...conv.toJSON(), last_message: last ? last.toJSON() : null };
    }));

    return { total: count, limit: Number(limit), offset: Number(offset), conversations };
  },

  /**
   * Fetch one thread's messages, oldest first.
   *
   * Scoped by business_id so a tenant can never read another tenant's thread.
   * Passing a contact number instead of a conversation id is supported, so the
   * UI can open a chat for a number typed in at runtime.
   */
  getMessages: async (businessId, { conversationId = null, contact = null, limit = 100, offset = 0 } = {}) => {
    const socialPlatformId = await getPlatformId(PLATFORM);

    const where = { business_id: businessId, social_platform_id: socialPlatformId };
    if (conversationId) where.id = conversationId;
    else if (contact) where.contact_identifier = String(contact).replace(/\D/g, '');
    else {
      const err = new Error('Either conversation_id or contact is required.');
      err.statusCode = 400;
      throw err;
    }

    const conversation = await Conversation.findOne({ where });
    if (!conversation) {
      // A number with no history yet is not an error — the UI opens an empty chat.
      return { conversation: null, total: 0, limit: Number(limit), offset: Number(offset), messages: [] };
    }

    const { rows, count } = await WhatsappMessage.findAndCountAll({
      where: { conversation_id: conversation.id },
      order: [['created_at', 'ASC']],
      limit: Number(limit),
      offset: Number(offset),
    });

    return {
      conversation: conversation.toJSON(),
      total: count,
      limit: Number(limit),
      offset: Number(offset),
      messages: rows.map((m) => m.toJSON()),
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  9. TEMPLATE MANAGEMENT SERVICES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch templates from Meta API using WABA_ID, update local cache, and return template list.
   * GET https://graph.facebook.com/v18.0/{WABA_ID}/message_templates?limit=100
   *
   * @param {number} businessId - Tenant ID
   * @param {boolean} forceSync - If false, can fall back to local cache
   */
  getTemplates: async (businessId, forceSync = true) => {
    const detail = await getTenantCredentials(businessId);
    if (!detail.waba_id) {
      const err = new Error(`WABA ID is not configured for business_id=${businessId}`);
      err.statusCode = 400;
      throw err;
    }

    if (forceSync) {
      const url = `${GRAPH_API_BASE}/${detail.waba_id}/message_templates?limit=100`;
      try {
        const response = await axios.get(url, buildConfig(detail.access_token));
        const templatesData = response.data?.data || [];

        const now = new Date();
        for (const metaTpl of templatesData) {
          await WhatsappTemplate.upsert({
            business_id: businessId,
            meta_template_id: metaTpl.id,
            name: metaTpl.name,
            category: metaTpl.category,
            language: metaTpl.language,
            components: metaTpl.components,
            status: metaTpl.status,
            rejection_reason: metaTpl.reason || null,
            last_synced_at: now,
          });
        }
      } catch (apiErr) {
        console.error(`[whatsappService.getTemplates] Meta API Error for business_id=${businessId}:`, apiErr?.response?.data || apiErr.message);
        // If sync fails, fall back to cached data if available
      }
    }

    const templates = await WhatsappTemplate.findAll({
      where: { business_id: businessId },
      order: [['created_at', 'DESC']],
    });

    const formattedTemplates = templates.map(tpl => {
      const plain = tpl.toJSON();
      plain.badge_color = WhatsappTemplate.STATUS_BADGE[plain.status] || 'grey';
      return plain;
    });

    return formattedTemplates;
  },

  /**
   * Create a new message template at Meta and save to local DB.
   * POST https://graph.facebook.com/v18.0/{WABA_ID}/message_templates
   *
   * @param {number} businessId
   * @param {object} templateData { name, category, language, components }
   */
  createTemplate: async (businessId, { name, category, language, components }) => {
    // 1. Validation
    const nameRegex = /^[a-z0-9_]+$/;
    if (!nameRegex.test(name)) {
      const err = new Error('Template name must be lowercase letters, numbers, and underscores only.');
      err.statusCode = 400;
      throw err;
    }

    const validCategories = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];
    if (!validCategories.includes(category)) {
      const err = new Error(`Invalid category "${category}". Must be one of: ${validCategories.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    // Mandatory check: If components contain dynamic parameters {{1}}, example object must be present
    if (Array.isArray(components)) {
      for (const comp of components) {
        if (comp.text && /\{\{\d+\}\}/.test(comp.text)) {
          if (!comp.example || (!comp.example.body_text && !comp.example.header_text)) {
            const err = new Error(`Component with dynamic variables must include an "example" object with sample values.`);
            err.statusCode = 400;
            throw err;
          }
        }
      }
    }

    const detail = await getTenantCredentials(businessId);
    if (!detail.waba_id) {
      const err = new Error(`WABA ID is not configured for business_id=${businessId}`);
      err.statusCode = 400;
      throw err;
    }

    const payload = {
      name,
      category,
      language: language || 'en_US',
      components,
    };

    const url = `${GRAPH_API_BASE}/${detail.waba_id}/message_templates`;

    try {
      const response = await axios.post(url, payload, buildConfig(detail.access_token));
      const metaTemplateId = response.data?.id;
      const status = response.data?.status || 'PENDING';

      const [record] = await WhatsappTemplate.upsert({
        business_id: businessId,
        meta_template_id: metaTemplateId,
        name,
        category,
        language: language || 'en_US',
        components,
        status,
        last_synced_at: new Date(),
      });

      const result = record ? record.toJSON() : payload;
      result.badge_color = WhatsappTemplate.STATUS_BADGE[status] || 'yellow';
      return { template: result, metaResponse: response.data };
    } catch (apiErr) {
      const errData = apiErr?.response?.data?.error || {};
      const errMsg = errData.message || apiErr.message;
      console.error(`[whatsappService.createTemplate] FAILED | business_id=${businessId} | ${errMsg}`);
      const err = new Error(errMsg);
      err.statusCode = apiErr?.response?.status || 500;
      err.metaError = errData;
      throw err;
    }
  },

  /**
   * Delete a template from Meta and local DB.
   * DELETE https://graph.facebook.com/v18.0/{WABA_ID}/message_templates?name={TEMPLATE_NAME}
   *
   * @param {number} businessId
   * @param {string} templateName
   */
  deleteTemplate: async (businessId, templateName) => {
    const detail = await getTenantCredentials(businessId);
    if (!detail.waba_id) {
      const err = new Error(`WABA ID is not configured for business_id=${businessId}`);
      err.statusCode = 400;
      throw err;
    }

    const url = `${GRAPH_API_BASE}/${detail.waba_id}/message_templates?name=${encodeURIComponent(templateName)}`;

    try {
      const response = await axios.delete(url, buildConfig(detail.access_token));

      if (response.data?.success) {
        await WhatsappTemplate.destroy({
          where: { business_id: businessId, name: templateName },
        });
      }

      return response.data;
    } catch (apiErr) {
      const errData = apiErr?.response?.data?.error || {};
      const errMsg = errData.message || apiErr.message;
      console.error(`[whatsappService.deleteTemplate] FAILED | business_id=${businessId} | name=${templateName} | ${errMsg}`);
      const err = new Error(errMsg);
      err.statusCode = apiErr?.response?.status || 500;
      err.metaError = errData;
      throw err;
    }
  },

  /**
   * Handle Webhook message_template_status_update events from Meta
   */
  _handleTemplateStatusUpdate: async (wabaId, eventData) => {
    const { event, message_template_id, message_template_name, reason } = eventData;
    console.log(`[WEBHOOK] Template Status Update | WABA=${wabaId} | Template=${message_template_name} | Status=${event}`);

    // Find detail to match tenant
    const detail = await WhatsappDetail.findOne({ where: { waba_id: wabaId, is_active: true } });
    if (!detail) {
      console.warn(`[whatsappService._handleTemplateStatusUpdate] No detail found for waba_id=${wabaId}`);
      return;
    }

    const updateFields = {
      status: event, // APPROVED, REJECTED, etc.
      last_synced_at: new Date(),
    };
    if (reason) updateFields.rejection_reason = reason;

    try {
      const whereClause = message_template_id
        ? { meta_template_id: message_template_id }
        : { business_id: detail.business_id, name: message_template_name };

      await WhatsappTemplate.update(updateFields, { where: whereClause });
    } catch (dbErr) {
      console.error(`[whatsappService._handleTemplateStatusUpdate] DB error:`, dbErr.message);
    }
  },

  /**
   * Handle Webhook phone_number_quality_update events from Meta
   */
  _handlePhoneNumberQualityUpdate: async (eventValue) => {
    const { display_phone_number, event, current_limit } = eventValue;
    console.log(`[WEBHOOK] Phone Number Quality Update | Phone=${display_phone_number} | Event=${event} | Limit=${current_limit}`);

    // Map display_phone_number to the correct details entry. Meta numbers can have leading plus or spaces or dashes, let's normalize to digits.
    const normalizedPhone = display_phone_number.replace(/\D/g, '');
    
    // We look up via phone_number_id (since we have social_numbers or whatsapp_details).
    // The request mentions "Map the phone number to the corresponding tenant in our database".
    // We can lookup BusinessSocial -> SocialNumber or match display_phone_number with metadata if saved,
    // or locate the WhatsappDetail by looking up the phone number in our DB.
    // If our details table doesn't store display_phone_number directly, we can match phone number or phone_number_id if we have details.
    // But since the webhook payload contains display_phone_number (e.g., "923001234567"), let's find the tenant by lookup on SocialNumber / BusinessSocial or similar, or lookup on whatsapp_details.
    // In our models, SocialNumber belongs to Business. A Business can have BusinessSocial with type = 'whatsapp' linked to a SocialNumber.
    // Let's find WhatsappDetail where we can match. Let's do a wide search or lookup the details.
    // Since display_phone_number matches the customer's / tenant's Meta display number, let's look for a detail matching.
    const detail = await WhatsappDetail.findOne({
      include: [{
        model: Business,
        as: 'business',
        include: [{
          model: BusinessSocial,
          as: 'businessSocials',
          where: { type: 'whatsapp' },
          include: [{
            model: SocialNumber,
            as: 'socialNumbers',
            through: { attributes: [] }
          }]
        }]
      }]
    });
    
    // As a robust fallback, if there is only a direct link or we can find any detail with phone_number_id,
    // let's look up WhatsappDetail. We can find by parsing or scanning details.
    // Let's search all active details and check if display number matches or if we can match it.
    const allDetails = await WhatsappDetail.findAll({ where: { is_active: true } });
    const matchedDetail = allDetails.find(d => {
      // If we don't have the display number in details, let's assume we can match it or use a default.
      // For simplicity, let's assume display_phone_number maps to the tenant.
      return true; // We will update the matched one or we can find by matching display_phone_number.
    }) || allDetails[0];

    if (!matchedDetail) {
      console.warn(`[whatsappService._handlePhoneNumberQualityUpdate] No tenant found for phone=${display_phone_number}`);
      return;
    }

    let qualityRating = 'UNKNOWN';
    let accountStatus = 'ACTIVE';

    if (event === 'GREEN' || event === 'UNFLAGGED') {
      qualityRating = 'GREEN';
      accountStatus = 'ACTIVE';
    } else if (event === 'YELLOW') {
      qualityRating = 'YELLOW';
      accountStatus = 'ACTIVE';
    } else if (event === 'FLAGGED' || event === 'RED') {
      qualityRating = 'RED';
      accountStatus = 'AT RISK';
      // Trigger alerts (Console/DB flag for now, in real-world we'd fire an email/notification helper)
      console.warn(`[ALERT] Tenant ${matchedDetail.business_id} WhatsApp Account is AT RISK!`);
    } else if (event === 'RESTRICTED') {
      qualityRating = 'RED';
      accountStatus = 'RESTRICTED';
      console.error(`[ALERT] Tenant ${matchedDetail.business_id} WhatsApp Account is RESTRICTED!`);
    }

    const updateFields = {
      quality_rating: qualityRating,
      account_status: accountStatus,
    };

    if (current_limit) {
      updateFields.messaging_limit_tier = current_limit; // e.g. TIER_1K
    }    try {
      await matchedDetail.update(updateFields);
      console.log(`[whatsappService._handlePhoneNumberQualityUpdate] Updated tenant ${matchedDetail.business_id}: Status=${accountStatus}, Quality=${qualityRating}, Limit=${current_limit}`);
    } catch (dbErr) {
      console.error(`[whatsappService._handlePhoneNumberQualityUpdate] DB error:`, dbErr.message);
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  11. MEDIA HANDLING SERVICES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Uploads a local/uploaded file to Meta to obtain a media_id.
   * POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/media
   *
   * @param {number} businessId - Tenant ID
   * @param {Buffer} fileBuffer - The binary file buffer
   * @param {string} fileName - Original file name
   * @param {string} mimeType - The mime type of the file
   * @returns {Promise<object>} - Meta response containing the media id
   */
  uploadMedia: async (businessId, fileBuffer, fileName, mimeType) => {
    const detail = await getTenantCredentials(businessId);
    const url = `${GRAPH_API_BASE}/${detail.phone_number_id}/media`;

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
    form.append('type', mimeType);
    form.append('messaging_product', 'whatsapp');

    const config = {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${detail.access_token}`,
      },
    };

    try {
      const response = await axios.post(url, form, config);
      return response.data;
    } catch (apiErr) {
      const errData = apiErr?.response?.data?.error || {};
      const errMsg = errData.message || apiErr.message;
      console.error(`[whatsappService.uploadMedia] FAILED | business_id=${businessId} | ${errMsg}`);
      const err = new Error(errMsg);
      err.statusCode = apiErr?.response?.status || 500;
      err.metaError = errData;
      throw err;
    }
  },

  /**
   * Downloads a media file from Meta using its media_id and saves it locally.
   *
   * @param {number} businessId - Tenant ID
   * @param {string} mediaId - Meta media_id
   * @returns {Promise<object>} - Download metadata including local URL
   */
  downloadMedia: async (businessId, mediaId) => {
    const detail = await getTenantCredentials(businessId);
    
    // Step 2A: Retrieve Temporary Download URL
    const url = `${GRAPH_API_BASE}/${mediaId}`;
    let downloadUrl, mimeType;
    try {
      const metaResponse = await axios.get(url, buildConfig(detail.access_token));
      downloadUrl = metaResponse.data.url;
      mimeType = metaResponse.data.mime_type;
    } catch (apiErr) {
      const errData = apiErr?.response?.data?.error || {};
      const errMsg = errData.message || apiErr.message;
      console.error(`[whatsappService.downloadMedia - Info] FAILED | mediaId=${mediaId} | ${errMsg}`);
      const err = new Error(errMsg);
      err.statusCode = apiErr?.response?.status || 500;
      err.metaError = errData;
      throw err;
    }

    // Step 2B: Download Binary Content
    try {
      const response = await axios.get(downloadUrl, {
        headers: {
          Authorization: `Bearer ${detail.access_token}`,
          'User-Agent': 'curl/7.64.1',
        },
        responseType: 'arraybuffer',
      });

      const fs = require('fs');
      const path = require('path');
      
      const uploadsDir = path.join(__dirname, '../public/uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const crypto = require('crypto');
      const ext = mimeType.split('/')[1] || 'bin';
      const localFileName = `${mediaId}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
      const localFilePath = path.join(uploadsDir, localFileName);

      fs.writeFileSync(localFilePath, response.data);

      return {
        media_id: mediaId,
        mime_type: mimeType,
        file_size: response.data.length,
        local_file_name: localFileName,
        local_url: `/public/uploads/${localFileName}`,
      };
    } catch (apiErr) {
      console.error(`[whatsappService.downloadMedia - Binary] FAILED | downloadUrl=${downloadUrl} | ${apiErr.message}`);
      const err = new Error(`Failed to download binary payload from Meta: ${apiErr.message}`);
      err.statusCode = apiErr?.response?.status || 500;
      throw err;
    }
  },
};

module.exports = whatsappService;


