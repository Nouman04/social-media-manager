'use strict';

const axios = require('axios');
const { Op } = require('sequelize');
const { InstagramDetail, InstagramMessage, Conversation, Business } = require('../../models');
const { findOrCreateConversation, getPlatformId } = require('../helpers/conversationHelper');
const realtime = require('../helpers/realtime');

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';
const PLATFORM = 'instagram';

// Instagram-scoped IDs are numeric strings.
const IGSID_RE = /^\d{5,32}$/;

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
  console.error(`[instagramService.${context}] FAILED | ${errMsg}`);
  const err = new Error(errMsg);
  err.statusCode = apiErr?.response?.status || 500;
  err.metaError = errData;
  return err;
};

/**
 * Fetch active InstagramDetail for a tenant (business_id). Throws if none.
 * @param {number} businessId
 * @returns {Promise<InstagramDetail>}
 */
const getTenantCredentials = async (businessId) => {
  const detail = await InstagramDetail.findOne({
    where: { business_id: businessId, is_active: true },
  });
  if (!detail) {
    const err = new Error(`No active Instagram credentials found for business_id=${businessId}`);
    err.statusCode = 404;
    throw err;
  }
  return detail;
};

/**
 * Persist an outbound message as 'queued' against its conversation.
 */
const createMessageRecord = async (conversationId, toIgsid, messageType, payload, senderId = null, receiverId = null) => {
  return InstagramMessage.create({
    conversation_id: conversationId,
    direction: 'outbound',
    to_igsid: toIgsid,
    message_type: messageType,
    payload,
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
    console.warn('[instagramService.emitOutbound] skipped:', err.message);
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
 * @param {string} args.toIgsid
 * @param {string} args.messageType  - Stored message_type.
 * @param {object} args.messageBody  - The `message` object sent to Meta.
 * @param {number} [args.senderId]
 * @param {number} [args.receiverId]
 * @returns {Promise<{record: InstagramMessage, metaResponse: object}>}
 */
const dispatchMessage = async ({ businessId, toIgsid, messageType, messageBody, senderId = null, receiverId = null }) => {
  if (!IGSID_RE.test(toIgsid)) {
    const err = new Error(`Invalid Instagram-scoped ID: "${toIgsid}". Must be a numeric IGSID.`);
    err.statusCode = 400;
    throw err;
  }

  const detail = await getTenantCredentials(businessId);

  const conversation = await findOrCreateConversation({
    businessId,
    platformName: PLATFORM,
    contactIdentifier: toIgsid,
    createdBy: senderId,
  });

  const payload = {
    recipient: { id: toIgsid },
    message: messageBody,
  };

  const record = await createMessageRecord(conversation.id, toIgsid, messageType, payload, senderId, receiverId);

  const url = `${GRAPH_API_BASE}/${detail.ig_user_id}/messages`;
  try {
    const response = await axios.post(url, payload, buildConfig(detail.access_token));
    const mid = response.data?.message_id || null;
    await markSent(record, mid);
    console.log(`[instagramService.dispatchMessage] Sent ${messageType} | tenant=${businessId} | to=${toIgsid} | mid=${mid}`);
    return { record: await record.reload(), metaResponse: response.data };
  } catch (apiErr) {
    const errData = apiErr?.response?.data?.error || {};
    const errCode = errData?.code ?? null;
    const errMsg = errData?.message ?? apiErr.message;
    console.error(`[instagramService.dispatchMessage] FAILED | tenant=${businessId} | code=${errCode} | ${errMsg}`);
    await markFailed(record, errCode, errMsg);
    const wrapped = new Error(errMsg);
    wrapped.statusCode = apiErr?.response?.status || 500;
    wrapped.metaError = errData;
    wrapped.record = record;
    throw wrapped;
  }
};

// ══════════════════════════════════════════════════════════════════════════════
const instagramService = {

  // ══════════════════════════════════════════════════════════════════════════
  //  1. VERIFY CREDENTIALS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Instagram credentials by fetching the professional account.
   * GET https://graph.facebook.com/v18.0/{IG_USER_ID}
   */
  verifyCredentials: async (igUserId, accessToken) => {
    const url = `${GRAPH_API_BASE}/${igUserId}`;
    const params = { fields: 'id,username,name,profile_picture_url,followers_count,media_count' };
    try {
      const response = await axios.get(url, { ...buildConfig(accessToken), params });
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'verifyCredentials');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  2. ADD INSTAGRAM ACCOUNT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Connect a vendor's Instagram Professional account to a business.
   * Credentials are verified against the Graph API before being stored, and
   * the @username is auto-filled from Meta.
   *
   * @param {number} businessId
   * @param {object} accountData { ig_user_id, page_id, access_token }
   * @returns {Promise<InstagramDetail>}
   */
  addAccount: async (businessId, { ig_user_id, page_id, access_token }) => {
    const business = await Business.findByPk(businessId);
    if (!business) {
      const err = new Error(`Business not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    // Fail before persisting if the credentials don't actually work.
    const profile = await instagramService.verifyCredentials(ig_user_id, access_token);

    try {
      const detail = await InstagramDetail.create({
        business_id: businessId,
        ig_user_id,
        page_id,
        access_token,
        username: profile.username || null,
      });
      console.log(`[instagramService.addAccount] Connected | tenant=${businessId} | ig_user_id=${ig_user_id}`);
      return detail;
    } catch (dbErr) {
      if (dbErr?.name === 'SequelizeUniqueConstraintError') {
        const err = new Error(`ig_user_id "${ig_user_id}" is already connected to a business.`);
        err.statusCode = 409;
        throw err;
      }
      throw dbErr;
    }
  },

  /**
   * Return the connected Instagram account for a tenant.
   * The access token is withheld from the response.
   */
  getAccount: async (businessId) => {
    const detail = await getTenantCredentials(businessId);
    const plain = detail.toJSON();
    delete plain.access_token;
    return plain;
  },

  /**
   * Update a connected account — typically to rotate an expiring token.
   * Any new token is verified before it replaces the stored one.
   */
  updateAccount: async (businessId, { page_id, access_token, is_active }) => {
    const detail = await getTenantCredentials(businessId);

    const updates = {};
    if (page_id !== undefined) updates.page_id = page_id;
    if (is_active !== undefined) updates.is_active = is_active;

    if (access_token) {
      const profile = await instagramService.verifyCredentials(detail.ig_user_id, access_token);
      updates.access_token = access_token;
      updates.username = profile.username || detail.username;
    }

    if (Object.keys(updates).length === 0) {
      const err = new Error('No updatable fields provided (page_id, access_token, is_active).');
      err.statusCode = 400;
      throw err;
    }

    await detail.update(updates);
    const plain = detail.toJSON();
    delete plain.access_token;
    return plain;
  },

  /**
   * Disconnect an Instagram account (soft delete — message history is kept).
   */
  deleteAccount: async (businessId) => {
    const detail = await getTenantCredentials(businessId);
    await detail.destroy();
    return { business_id: businessId, ig_user_id: detail.ig_user_id, disconnected: true };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3. ACCOUNT PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch the connected Instagram professional profile from Meta.
   */
  getProfile: async (businessId) => {
    const detail = await getTenantCredentials(businessId);
    const url = `${GRAPH_API_BASE}/${detail.ig_user_id}`;
    const params = {
      fields: 'id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count',
    };
    try {
      const response = await axios.get(url, { ...buildConfig(detail.access_token), params });
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'getProfile');
    }
  },

  /**
   * Fetch a contact's public profile by their Instagram-scoped ID.
   * Useful for showing a name/avatar next to an inbound conversation.
   */
  getContactProfile: async (businessId, igsid) => {
    const detail = await getTenantCredentials(businessId);
    const url = `${GRAPH_API_BASE}/${igsid}`;
    const params = { fields: 'name,username,profile_pic,is_verified_user,follower_count' };
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
   * Send a plain text Direct message.
   *
   * Instagram only allows free-form replies inside the 24-hour window that
   * opens when the contact last messaged the account.
   *
   * @param {number} businessId
   * @param {string} toIgsid
   * @param {string} text
   * @param {number} [senderId]
   * @param {number} [receiverId]
   */
  sendTextMessage: async (businessId, toIgsid, text, senderId = null, receiverId = null) => {
    if (!text || !String(text).trim()) {
      const err = new Error('Message text is required.');
      err.statusCode = 400;
      throw err;
    }

    return dispatchMessage({
      businessId,
      toIgsid,
      messageType: 'text',
      messageBody: { text },
      senderId,
      receiverId,
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  5. SEND MEDIA MESSAGE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send an image / video / audio / file attachment by public URL.
   *
   * @param {number} businessId
   * @param {string} toIgsid
   * @param {'image'|'video'|'audio'|'file'} mediaType
   * @param {string} mediaUrl - Publicly reachable URL of the asset.
   */
  sendMediaMessage: async (businessId, toIgsid, mediaType, mediaUrl, senderId = null, receiverId = null) => {
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
      toIgsid,
      messageType: mediaType,
      messageBody: {
        attachment: {
          type: mediaType,
          payload: { url: mediaUrl, is_reusable: true },
        },
      },
      senderId,
      receiverId,
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  6. SEND REACTION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * React to (or un-react to) a message the contact sent.
   * POST /{IG_USER_ID}/messages with sender_action.
   */
  sendReaction: async (businessId, toIgsid, messageId, reaction = 'love', unreact = false) => {
    const detail = await getTenantCredentials(businessId);

    const payload = {
      recipient: { id: toIgsid },
      sender_action: unreact ? 'unreact' : 'react',
      payload: { message_id: messageId, ...(unreact ? {} : { reaction }) },
    };

    const url = `${GRAPH_API_BASE}/${detail.ig_user_id}/messages`;
    try {
      const response = await axios.post(url, payload, buildConfig(detail.access_token));
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'sendReaction');
    }
  },

  /**
   * Mark the conversation as seen (blue tick) for a contact.
   */
  markSeen: async (businessId, toIgsid) => {
    const detail = await getTenantCredentials(businessId);
    const payload = { recipient: { id: toIgsid }, sender_action: 'mark_seen' };
    const url = `${GRAPH_API_BASE}/${detail.ig_user_id}/messages`;
    try {
      const response = await axios.post(url, payload, buildConfig(detail.access_token));
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'markSeen');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  7. INBOX — CONVERSATIONS & MESSAGES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * List Instagram conversation threads for a tenant, newest activity first.
   */
  getConversations: async (businessId, { limit = 50, offset = 0 } = {}) => {
    const socialPlatformId = await getPlatformId(PLATFORM);

    const { rows, count } = await Conversation.findAndCountAll({
      where: { business_id: businessId, social_platform_id: socialPlatformId },
      order: [['updated_at', 'DESC']],
      limit: Number(limit),
      offset: Number(offset),
    });

    // Attach the latest message so the inbox can show a preview line.
    const conversations = await Promise.all(rows.map(async (conv) => {
      const last = await InstagramMessage.findOne({
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
      const err = new Error(`Instagram conversation ${conversationId} not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    const { rows, count } = await InstagramMessage.findAndCountAll({
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
  //  8. WEBHOOK — VERIFICATION TOKEN CHECK
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Validate the Meta webhook verification handshake.
   * Falls back to the shared WhatsApp verify token when no Instagram-specific
   * one is configured, since Meta apps often reuse a single token.
   */
  verifyWebhookToken: (mode, token, challenge) => {
    const systemToken = process.env.INSTAGRAM_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && token && token === systemToken) {
      return { valid: true, challenge };
    }
    return { valid: false };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  9. WEBHOOK — EVENT PROCESSOR (MULTI-TENANT ROUTING)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Process an inbound Instagram webhook payload and route it to the tenant
   * that owns the receiving account.
   *
   * Instagram delivers Direct messages under entry[].messaging[] (Messenger
   * shape), and comment/mention events under entry[].changes[].
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
        // For inbound, recipient.id is our account; for echoes it's the contact.
        const isEcho = Boolean(event?.message?.is_echo);
        const accountId = isEcho ? event?.sender?.id : event?.recipient?.id;
        const contactId = isEcho ? event?.recipient?.id : event?.sender?.id;

        if (!accountId || !contactId) {
          result.skipped++;
          continue;
        }

        let detail;
        try {
          detail = await InstagramDetail.findOne({
            where: { ig_user_id: String(accountId), is_active: true },
            include: [{ model: Business, as: 'business', attributes: ['id', 'name', 'created_by'] }],
          });
        } catch (dbErr) {
          result.errors.push({ accountId, error: dbErr.message });
          continue;
        }

        if (!detail) {
          console.warn(`[instagramService.processWebhookEvent] No active tenant for ig_user_id: ${accountId}`);
          result.skipped++;
          continue;
        }

        try {
          if (event.message && !isEcho) {
            await instagramService._handleInboundMessage(detail, contactId, event);
            result.processed++;
          } else if (event.read || event.delivery) {
            await instagramService._handleStatusUpdate(detail, event);
            result.processed++;
          } else {
            result.skipped++;
          }
        } catch (handlerErr) {
          console.error('[instagramService.processWebhookEvent] Handler error:', handlerErr.message);
          result.errors.push({ accountId, error: handlerErr.message });
        }
      }

      // Comment / mention / story-insight events arrive under `changes`.
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        console.log(`[WEBHOOK][IG] Unhandled change field="${change.field}" — logged only.`);
        result.skipped++;
      }
    }

    return result;
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PRIVATE — INTERNAL HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Persist an inbound Direct message against its conversation.
   */
  _handleInboundMessage: async (detail, contactIgsid, event) => {
    const message = event.message || {};
    const tenantId = detail.business_id;

    console.log(
      `[WEBHOOK][IG] Inbound | tenant=${tenantId} | from=${contactIgsid} | mid=${message.mid}`
    );

    // Classify the message so the inbox can render it correctly.
    let messageType = 'text';
    const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null;
    if (message.reply_to?.story) {
      messageType = 'story_reply';
    } else if (attachment) {
      const attachmentType = attachment.type;
      messageType = ['image', 'video', 'audio', 'file', 'share'].includes(attachmentType)
        ? attachmentType
        : 'file';
    }

    const conversation = await findOrCreateConversation({
      businessId: tenantId,
      platformName: PLATFORM,
      contactIdentifier: String(contactIgsid),
      createdBy: detail.business?.created_by || null,
    });

    try {
      const saved = await InstagramMessage.create({
        conversation_id: conversation.id,
        direction: 'inbound',
        from_igsid: String(contactIgsid),
        to_igsid: String(detail.ig_user_id),
        message_type: messageType,
        mid: message.mid || null,
        payload: event,
        status: 'delivered', // inbound messages have already arrived
        receiver_id: detail.business?.created_by || null,
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
        console.warn(`[instagramService._handleInboundMessage] Duplicate mid ${message.mid} — skipped.`);
      } else {
        console.error('[instagramService._handleInboundMessage] DB error:', dbErr.message);
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
      const targets = await InstagramMessage.findAll({ where: whereClause, attributes: ['id', 'mid'] });
      if (!targets.length) return;

      await InstagramMessage.update({ status: newStatus }, { where: whereClause });

      targets.forEach((record) => {
        realtime.emitToBusiness(detail.business_id, 'message:status', {
          id: record.id,
          mid: record.mid,
          conversation_id: conversation.id,
          status: newStatus,
        });
      });
    } catch (dbErr) {
      console.error('[instagramService._handleStatusUpdate] DB error:', dbErr.message);
    }
  },
};

module.exports = instagramService;
