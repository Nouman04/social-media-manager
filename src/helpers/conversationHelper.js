'use strict';

const { Conversation, ConversationParticipant, SocialPlatform, Business } = require('../../models');

// Platform rows are a small, effectively static lookup table — cache the id
// per platform name so we don't hit the DB on every inbound webhook message.
const platformIdCache = new Map();

/**
 * Resolve a social platform's id from its machine name (e.g. 'whatsapp').
 * @param {string} name
 * @returns {Promise<number>}
 */
const getPlatformId = async (name) => {
  if (platformIdCache.has(name)) return platformIdCache.get(name);

  const platform = await SocialPlatform.findOne({ where: { name } });
  if (!platform) {
    const err = new Error(`Social platform "${name}" is not registered in social_platforms.`);
    err.statusCode = 500;
    throw err;
  }

  platformIdCache.set(name, platform.id);
  return platform.id;
};

/**
 * Find — or create — the conversation thread for one external contact on one
 * platform for one business.
 *
 * Every message row hangs off a conversation, so both the outbound send paths
 * and the inbound webhook handlers call this before persisting anything.
 *
 * @param {object}  args
 * @param {number}  args.businessId       - Tenant.
 * @param {string}  args.platformName     - e.g. 'whatsapp' | 'instagram'.
 * @param {string}  args.contactIdentifier- Phone number (WhatsApp) or scoped user id (Instagram).
 * @param {string} [args.contactName]     - Display name, when the platform gives one.
 * @param {number} [args.createdBy]       - System user to record as creator; falls back to the business owner.
 * @returns {Promise<Conversation>}
 */
const findOrCreateConversation = async ({
  businessId,
  platformName,
  contactIdentifier,
  contactName = null,
  createdBy = null,
}) => {
  if (!contactIdentifier) {
    const err = new Error('contactIdentifier is required to resolve a conversation.');
    err.statusCode = 400;
    throw err;
  }

  const socialPlatformId = await getPlatformId(platformName);

  const existing = await Conversation.findOne({
    where: {
      business_id: businessId,
      social_platform_id: socialPlatformId,
      contact_identifier: contactIdentifier,
    },
  });

  if (existing) {
    // Keep the display name fresh — contacts rename themselves.
    if (contactName && existing.contact_name !== contactName) {
      await existing.update({ contact_name: contactName });
    }
    return existing;
  }

  // conversations.created_by is NOT NULL — fall back to the business owner
  // for webhook-created threads, where there is no acting user.
  let creatorId = createdBy;
  if (!creatorId) {
    const business = await Business.findByPk(businessId, { attributes: ['id', 'created_by'] });
    if (!business) {
      const err = new Error(`Business not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }
    creatorId = business.created_by;
  }

  try {
    const conversation = await Conversation.create({
      business_id: businessId,
      social_platform_id: socialPlatformId,
      contact_identifier: contactIdentifier,
      contact_name: contactName,
      type: 'private',
      created_by: creatorId,
    });

    // Record the acting/owning system user as a participant so the thread
    // shows up in their inbox.
    await ConversationParticipant.findOrCreate({
      where: { conversation_id: conversation.id, user_id: creatorId },
      defaults: { conversation_id: conversation.id, user_id: creatorId },
    });

    return conversation;
  } catch (dbErr) {
    // Two webhook events for a brand-new contact can race here; the unique
    // index on (business, platform, contact) makes the loser retry the read.
    if (dbErr?.name === 'SequelizeUniqueConstraintError') {
      const raced = await Conversation.findOne({
        where: {
          business_id: businessId,
          social_platform_id: socialPlatformId,
          contact_identifier: contactIdentifier,
        },
      });
      if (raced) return raced;
    }
    throw dbErr;
  }
};

module.exports = {
  getPlatformId,
  findOrCreateConversation,
};
