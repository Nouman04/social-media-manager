'use strict';

const axios = require('axios');
const { Op } = require('sequelize');
const { MessengerDetail, MessengerMessage, Conversation, Business } = require('../../models');
const { findOrCreateConversation, getPlatformId } = require('../helpers/conversationHelper');
const realtime = require('../helpers/realtime');

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';
const PLATFORM = 'messenger';

// Page-Scoped IDs are numeric strings.
const PSID_RE = /^\d{5,32}$/;

// Meta requires a messaging_type on every send.
const MESSAGING_TYPES = ['RESPONSE', 'UPDATE', 'MESSAGE_TAG'];

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
 * Normalise a Graph API failure into an Error carrying statusCode + metaError.
 */
const wrapMetaError = (apiErr, context) => {
  const errData = apiErr?.response?.data?.error || {};
  const errMsg = errData.message || apiErr.message;
  console.error(`[messengerService.${context}] FAILED | ${errMsg}`);
  const err = new Error(errMsg);
  err.statusCode = apiErr?.response?.status || 500;
  err.metaError = errData;
  return err;
};

/**
 * Fetch active MessengerDetail for a tenant (business_id). Throws if none.
 * @param {number} businessId
 * @returns {Promise<MessengerDetail>}
 */
const getTenantCredentials = async (businessId) => {
  const detail = await MessengerDetail.findOne({
    where: { business_id: businessId, is_active: true },
  });
  if (!detail) {
    const err = new Error(`No active Messenger credentials found for business_id=${businessId}`);
    err.statusCode = 404;
    throw err;
  }
  return detail;
};

/**
 * Persist an outbound message as 'queued' against its conversation.
 */
const createMessageRecord = async ({
  conversationId, toPsid, messageType, payload, messagingType, messageTag, senderId, receiverId,
}) => {
  return MessengerMessage.create({
    conversation_id: conversationId,
    direction: 'outbound',
    to_psid: toPsid,
    message_type: messageType,
    payload,
    messaging_type: messagingType,
    message_tag: messageTag,
    status: 'queued',
    sender_id: senderId,
    receiver_id: receiverId,
  });
};

const markSent = async (record, mid) => {
  await record.update({ mid, status: 'sent' });
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
    console.warn('[messengerService.emitOutbound] skipped:', err.message);
  }
};

const markFailed = async (record, errorCode, errorMessage) => {
  await record.update({ status: 'failed', error_code: errorCode, error_message: errorMessage });
};

/**
 * Shared outbound path: resolve credentials + conversation, persist the record,
 * POST to the Graph API, then mark the record sent or failed.
 *
 * @param {object} args
 * @param {number} args.businessId
 * @param {string} args.toPsid
 * @param {string} args.messageType    - Stored message_type.
 * @param {object} args.messageBody    - The `message` object sent to Meta.
 * @param {string} [args.messagingType]- RESPONSE (default) / UPDATE / MESSAGE_TAG.
 * @param {string} [args.messageTag]   - Required when messagingType is MESSAGE_TAG.
 * @returns {Promise<{record: MessengerMessage, metaResponse: object}>}
 */
const dispatchMessage = async ({
  businessId, toPsid, messageType, messageBody,
  messagingType = 'RESPONSE', messageTag = null, senderId = null, receiverId = null,
}) => {
  if (!PSID_RE.test(toPsid)) {
    const err = new Error(`Invalid Page-Scoped ID: "${toPsid}". Must be a numeric PSID.`);
    err.statusCode = 400;
    throw err;
  }

  if (!MESSAGING_TYPES.includes(messagingType)) {
    const err = new Error(`Invalid messaging_type "${messagingType}". Must be one of: ${MESSAGING_TYPES.join(', ')}.`);
    err.statusCode = 400;
    throw err;
  }

  // Meta rejects MESSAGE_TAG sends that don't name the tag being claimed.
  if (messagingType === 'MESSAGE_TAG' && !messageTag) {
    const err = new Error('message_tag is required when messaging_type is MESSAGE_TAG (e.g. HUMAN_AGENT).');
    err.statusCode = 400;
    throw err;
  }

  const detail = await getTenantCredentials(businessId);

  const conversation = await findOrCreateConversation({
    businessId,
    platformName: PLATFORM,
    contactIdentifier: toPsid,
    createdBy: senderId,
  });

  const payload = {
    recipient: { id: toPsid },
    messaging_type: messagingType,
    message: messageBody,
    ...(messageTag ? { tag: messageTag } : {}),
  };

  const record = await createMessageRecord({
    conversationId: conversation.id,
    toPsid,
    messageType,
    payload,
    messagingType,
    messageTag,
    senderId,
    receiverId,
  });

  const url = `${GRAPH_API_BASE}/${detail.page_id}/messages`;
  try {
    const response = await axios.post(url, payload, buildConfig(detail.access_token));
    const mid = response.data?.message_id || null;
    await markSent(record, mid);
    console.log(`[messengerService.dispatchMessage] Sent ${messageType} | tenant=${businessId} | to=${toPsid} | mid=${mid}`);
    return { record: await record.reload(), metaResponse: response.data };
  } catch (apiErr) {
    const errData = apiErr?.response?.data?.error || {};
    const errCode = errData?.code ?? null;
    const errMsg = errData?.message ?? apiErr.message;
    console.error(`[messengerService.dispatchMessage] FAILED | tenant=${businessId} | code=${errCode} | ${errMsg}`);
    await markFailed(record, errCode, errMsg);
    const wrapped = new Error(errMsg);
    wrapped.statusCode = apiErr?.response?.status || 500;
    wrapped.metaError = errData;
    wrapped.record = record;
    throw wrapped;
  }
};

// ══════════════════════════════════════════════════════════════════════════════
const messengerService = {

  // ══════════════════════════════════════════════════════════════════════════
  //  1. VERIFY CREDENTIALS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Page credentials by fetching the Page.
   * GET https://graph.facebook.com/v18.0/{PAGE_ID}
   */
  verifyCredentials: async (pageId, accessToken) => {
    const url = `${GRAPH_API_BASE}/${pageId}`;
    const params = { fields: 'id,name,username,category,link,fan_count' };
    try {
      const response = await axios.get(url, { ...buildConfig(accessToken), params });
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'verifyCredentials');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  2. ACCOUNT MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Connect a vendor's Facebook Page to a business.
   * Credentials are verified against the Graph API before being stored, and
   * the Page name is auto-filled from Meta.
   *
   * @param {number} businessId
   * @param {object} accountData { page_id, access_token }
   * @returns {Promise<MessengerDetail>}
   */
  addAccount: async (businessId, { page_id, access_token }) => {
    const business = await Business.findByPk(businessId);
    if (!business) {
      const err = new Error(`Business not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    // Fail before persisting if the credentials don't actually work.
    const page = await messengerService.verifyCredentials(page_id, access_token);

    try {
      const detail = await MessengerDetail.create({
        business_id: businessId,
        page_id,
        access_token,
        page_name: page.name || null,
      });
      console.log(`[messengerService.addAccount] Connected | tenant=${businessId} | page_id=${page_id}`);
      return detail;
    } catch (dbErr) {
      if (dbErr?.name === 'SequelizeUniqueConstraintError') {
        const err = new Error(`page_id "${page_id}" is already connected to a business.`);
        err.statusCode = 409;
        throw err;
      }
      throw dbErr;
    }
  },

  /**
   * Return the connected Page for a tenant. The access token is withheld.
   */
  getAccount: async (businessId) => {
    const detail = await getTenantCredentials(businessId);
    const plain = detail.toJSON();
    delete plain.access_token;
    return plain;
  },

  /**
   * Update a connected Page — typically to rotate an expiring token.
   * Any new token is verified before it replaces the stored one.
   */
  updateAccount: async (businessId, { access_token, is_active }) => {
    const detail = await getTenantCredentials(businessId);

    const updates = {};
    if (is_active !== undefined) updates.is_active = is_active;

    if (access_token) {
      const page = await messengerService.verifyCredentials(detail.page_id, access_token);
      updates.access_token = access_token;
      updates.page_name = page.name || detail.page_name;
    }

    if (Object.keys(updates).length === 0) {
      const err = new Error('No updatable fields provided (access_token, is_active).');
      err.statusCode = 400;
      throw err;
    }

    await detail.update(updates);
    const plain = detail.toJSON();
    delete plain.access_token;
    return plain;
  },

  /**
   * Disconnect a Page (soft delete — message history is kept).
   */
  deleteAccount: async (businessId) => {
    const detail = await getTenantCredentials(businessId);
    await detail.destroy();
    return { business_id: businessId, page_id: detail.page_id, disconnected: true };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3. PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch the connected Page's own profile from Meta.
   */
  getProfile: async (businessId) => {
    const detail = await getTenantCredentials(businessId);
    const url = `${GRAPH_API_BASE}/${detail.page_id}`;
    const params = {
      fields: 'id,name,username,about,category,link,picture,fan_count,followers_count',
    };
    try {
      const response = await axios.get(url, { ...buildConfig(detail.access_token), params });
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'getProfile');
    }
  },

  /**
   * Fetch a contact's profile by their Page-Scoped ID.
   * Useful for showing a name/avatar next to an inbound conversation.
   */
  getContactProfile: async (businessId, psid) => {
    const detail = await getTenantCredentials(businessId);
    const url = `${GRAPH_API_BASE}/${psid}`;
    const params = { fields: 'first_name,last_name,profile_pic,locale,timezone' };
    try {
      const response = await axios.get(url, { ...buildConfig(detail.access_token), params });
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'getContactProfile');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  4. SEND TEXT MESSAGE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send a plain text Messenger message.
   *
   * Free-form replies are only allowed inside the 24-hour window that opens
   * when the contact last messaged the Page. To reply later, pass
   * messaging_type = MESSAGE_TAG with a valid tag (e.g. HUMAN_AGENT).
   */
  sendTextMessage: async (businessId, toPsid, text, {
    messagingType = 'RESPONSE', messageTag = null, senderId = null, receiverId = null,
  } = {}) => {
    if (!text || !String(text).trim()) {
      const err = new Error('Message text is required.');
      err.statusCode = 400;
      throw err;
    }

    return dispatchMessage({
      businessId,
      toPsid,
      messageType: 'text',
      messageBody: { text },
      messagingType,
      messageTag,
      senderId,
      receiverId,
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  5. SEND MEDIA MESSAGE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send an image / video / audio / file attachment by public URL.
   */
  sendMediaMessage: async (businessId, toPsid, mediaType, mediaUrl, {
    messagingType = 'RESPONSE', messageTag = null, senderId = null, receiverId = null,
  } = {}) => {
    const VALID_TYPES = ['image', 'video', 'audio', 'file'];
    if (!VALID_TYPES.includes(mediaType)) {
      const err = new Error(`Invalid media type "${mediaType}". Must be one of: ${VALID_TYPES.join(', ')}.`);
      err.statusCode = 400;
      throw err;
    }
    if (!mediaUrl) {
      const err = new Error('media_url is required.');
      err.statusCode = 400;
      throw err;
    }

    return dispatchMessage({
      businessId,
      toPsid,
      messageType: mediaType,
      messageBody: {
        attachment: {
          type: mediaType,
          payload: { url: mediaUrl, is_reusable: true },
        },
      },
      messagingType,
      messageTag,
      senderId,
      receiverId,
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  6. SEND QUICK REPLIES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send a text message with tappable quick-reply buttons.
   *
   * @param {Array} quickReplies - [{ title, payload }, ...] (max 13 per Meta).
   */
  sendQuickReplies: async (businessId, toPsid, text, quickReplies, {
    messagingType = 'RESPONSE', messageTag = null, senderId = null, receiverId = null,
  } = {}) => {
    if (!Array.isArray(quickReplies) || quickReplies.length === 0) {
      const err = new Error('quick_replies must be a non-empty array of { title, payload }.');
      err.statusCode = 400;
      throw err;
    }
    if (quickReplies.length > 13) {
      const err = new Error('Meta allows at most 13 quick replies per message.');
      err.statusCode = 400;
      throw err;
    }

    const invalid = quickReplies.find((qr) => !qr?.title || !qr?.payload);
    if (invalid) {
      const err = new Error('Every quick reply needs both a "title" and a "payload".');
      err.statusCode = 400;
      throw err;
    }

    return dispatchMessage({
      businessId,
      toPsid,
      messageType: 'quick_reply',
      messageBody: {
        text,
        quick_replies: quickReplies.map((qr) => ({
          content_type: 'text',
          title: qr.title,
          payload: qr.payload,
        })),
      },
      messagingType,
      messageTag,
      senderId,
      receiverId,
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  7. SENDER ACTIONS (typing indicator / mark seen)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send a sender action: mark_seen, typing_on, or typing_off.
   * These are UI signals only — nothing is persisted.
   */
  sendSenderAction: async (businessId, toPsid, senderAction) => {
    const VALID_ACTIONS = ['mark_seen', 'typing_on', 'typing_off'];
    if (!VALID_ACTIONS.includes(senderAction)) {
      const err = new Error(`Invalid sender_action "${senderAction}". Must be one of: ${VALID_ACTIONS.join(', ')}.`);
      err.statusCode = 400;
      throw err;
    }

    const detail = await getTenantCredentials(businessId);
    const payload = { recipient: { id: toPsid }, sender_action: senderAction };
    const url = `${GRAPH_API_BASE}/${detail.page_id}/messages`;

    try {
      const response = await axios.post(url, payload, buildConfig(detail.access_token));
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'sendSenderAction');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  8. INBOX — CONVERSATIONS & MESSAGES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * List Messenger conversation threads for a tenant, newest activity first.
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
      const last = await MessengerMessage.findOne({
        where: { conversation_id: conv.id },
        order: [['created_at', 'DESC']],
      });
      return { ...conv.toJSON(), last_message: last ? last.toJSON() : null };
    }));

    return { total: count, limit: Number(limit), offset: Number(offset), conversations };
  },

  /**
   * Fetch the message history of one conversation, oldest first.
   * Scoped by business_id so one tenant cannot read another's thread.
   */
  getMessages: async (businessId, conversationId, { limit = 50, offset = 0 } = {}) => {
    const socialPlatformId = await getPlatformId(PLATFORM);

    const conversation = await Conversation.findOne({
      where: { id: conversationId, business_id: businessId, social_platform_id: socialPlatformId },
    });
    if (!conversation) {
      const err = new Error(`Messenger conversation ${conversationId} not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    const { rows, count } = await MessengerMessage.findAndCountAll({
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
  //  9. WEBHOOK — VERIFICATION TOKEN CHECK
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Validate the Meta webhook verification handshake.
   * Checks against META_VERIFY_TOKEN — the shared verify token Instagram and
   * Messenger both use on the /api/v1/meta/webhook endpoint — falling back to
   * a Messenger-specific token if that's what's configured instead.
   */
  verifyWebhookToken: (mode, token, challenge) => {
    const systemToken = process.env.META_VERIFY_TOKEN || process.env.MESSENGER_VERIFY_TOKEN;
    if (mode === 'subscribe' && token && token === systemToken) {
      return { valid: true, challenge };
    }
    return { valid: false };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  10. WEBHOOK — EVENT PROCESSOR (MULTI-TENANT ROUTING)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Process an inbound Messenger webhook payload and route it to the tenant
   * that owns the receiving Page.
   *
   * Messenger delivers events under entry[].messaging[]; entry.id is the Page ID.
   *
   * @param {object} body - req.body from the webhook POST.
   * @returns {Promise<object>} - { processed, skipped, errors }
   */
  processWebhookEvent: async (body) => {
    const result = { processed: 0, skipped: 0, errors: [] };

    const entries = body?.entry;
    if (!Array.isArray(entries) || entries.length === 0) {
      result.skipped++;
      return result;
    }

    for (const entry of entries) {
      const events = Array.isArray(entry?.messaging) ? entry.messaging : [];

      for (const event of events) {
        // For inbound, recipient.id is the Page; for echoes it's the contact.
        const isEcho = Boolean(event?.message?.is_echo);
        const pageId = isEcho ? event?.sender?.id : event?.recipient?.id;
        const contactId = isEcho ? event?.recipient?.id : event?.sender?.id;

        if (!pageId || !contactId) {
          result.skipped++;
          continue;
        }

        let detail;
        try {
          detail = await MessengerDetail.findOne({
            where: { page_id: String(pageId), is_active: true },
            include: [{ model: Business, as: 'business', attributes: ['id', 'name', 'created_by'] }],
          });
        } catch (dbErr) {
          result.errors.push({ pageId, error: dbErr.message });
          continue;
        }

        if (!detail) {
          console.warn(`[messengerService.processWebhookEvent] No active tenant for page_id: ${pageId}`);
          result.skipped++;
          continue;
        }

        try {
          if ((event.message && !isEcho) || event.postback) {
            await messengerService._handleInboundMessage(detail, contactId, event);
            result.processed++;
          } else if (event.read || event.delivery) {
            await messengerService._handleStatusUpdate(detail, event);
            result.processed++;
          } else {
            result.skipped++;
          }
        } catch (handlerErr) {
          console.error('[messengerService.processWebhookEvent] Handler error:', handlerErr.message);
          result.errors.push({ pageId, error: handlerErr.message });
        }
      }
    }

    return result;
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — INTERNAL HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Persist an inbound message (or postback) against its conversation.
   */
  _handleInboundMessage: async (detail, contactPsid, event) => {
    const message = event.message || {};
    const tenantId = detail.business_id;

    // Postbacks carry their id under event.postback, not event.message — read
    // both so replayed postbacks de-duplicate on the unique mid too.
    const mid = message.mid || event.postback?.mid || null;

    console.log(
      `[WEBHOOK][MSG] Inbound | tenant=${tenantId} | from=${contactPsid} | mid=${mid || '(none)'}`
    );

    // Classify the message so the inbox can render it correctly.
    let messageType = 'text';
    if (event.postback) {
      messageType = 'postback';
    } else if (message.quick_reply) {
      messageType = 'quick_reply';
    } else {
      const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null;
      if (attachment) {
        const attachmentType = attachment.type;
        messageType = ['image', 'video', 'audio', 'file'].includes(attachmentType)
          ? attachmentType
          : 'template';
      }
    }

    const ownerId = detail.business?.created_by || null;

    const conversation = await findOrCreateConversation({
      businessId: tenantId,
      platformName: PLATFORM,
      contactIdentifier: String(contactPsid),
      createdBy: ownerId,
    });

    try {
      const saved = await MessengerMessage.create({
        conversation_id: conversation.id,
        direction: 'inbound',
        from_psid: String(contactPsid),
        to_psid: String(detail.page_id),
        message_type: messageType,
        mid,
        payload: event,
        status: 'delivered', // inbound messages have already arrived
        receiver_id: ownerId,
      });

      // Bump the thread so the inbox sorts it to the top. `silent: true` stops
      // Sequelize from overwriting the timestamp we set explicitly.
      await Conversation.update(
        { updated_at: new Date() },
        { where: { id: conversation.id }, silent: true }
      );

      // Push it to any open inbox for this tenant.
      realtime.emitToBusiness(tenantId, 'message:inbound', {
        message: saved.toJSON(),
        conversation: {
          id: conversation.id,
          contact_identifier: conversation.contact_identifier,
          contact_name: conversation.contact_name || null,
        },
      });
    } catch (dbErr) {
      // Meta retries deliveries; the unique mid makes replays a no-op.
      if (dbErr?.name === 'SequelizeUniqueConstraintError') {
        console.warn(`[messengerService._handleInboundMessage] Duplicate mid ${mid} — skipped.`);
      } else {
        console.error('[messengerService._handleInboundMessage] DB error:', dbErr.message);
      }
    }
  },

  /**
   * Apply read / delivery receipts to previously sent messages.
   */
  _handleStatusUpdate: async (detail, event) => {
    const conversation = await Conversation.findOne({
      where: {
        business_id: detail.business_id,
        social_platform_id: await getPlatformId(PLATFORM),
        contact_identifier: String(event?.sender?.id || ''),
      },
    });

    if (!conversation) return;

    // `read` carries a watermark timestamp: everything sent at or before it
    // has been seen. `delivery` works the same way for delivery receipts.
    const newStatus = event.read ? 'read' : 'delivered';
    const watermark = event.read?.watermark ?? event.delivery?.watermark;
    if (!watermark) return;

    const whereClause = {
      conversation_id: conversation.id,
      direction: 'outbound',
      created_at: { [Op.lte]: new Date(Number(watermark)) },
      status: newStatus === 'read' ? { [Op.in]: ['sent', 'delivered'] } : 'sent',
    };

    try {
      // MySQL's UPDATE doesn't hand back the affected rows, so capture the ids
      // that are about to change before applying the update.
      const targets = await MessengerMessage.findAll({ where: whereClause, attributes: ['id', 'mid'] });
      if (!targets.length) return;

      await MessengerMessage.update({ status: newStatus }, { where: whereClause });

      targets.forEach((record) => {
        realtime.emitToBusiness(detail.business_id, 'message:status', {
          id: record.id,
          mid: record.mid,
          conversation_id: conversation.id,
          status: newStatus,
        });
      });
    } catch (dbErr) {
      console.error('[messengerService._handleStatusUpdate] DB error:', dbErr.message);
    }
  },
};

module.exports = messengerService;
