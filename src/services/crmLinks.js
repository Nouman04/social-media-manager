'use strict';

/**
 * Shared checks for records that link to a contact, a conversation, a member
 * and tags (deals, tickets). Every id must belong to the caller's business.
 */
const { Contact, Conversation, Tag } = require('../../models');
const inbox = require('./inboxService');
const { httpError } = require('../helpers/uuid');

const USER_BRIEF = ['id', 'name', 'email', 'avatar'];

const contactFor = async (businessId, contactId) => {
  if (contactId == null) return null;
  const contact = await Contact.findOne({ where: { id: contactId, business_id: businessId }, attributes: ['id', 'name', 'phone'] });
  if (!contact) throw httpError(400, 'contact_id is not a contact of this business');
  return contact;
};

/** Conversation of this business plus its channel name (whatsapp | instagram | messenger). */
const conversationFor = async (businessId, conversationId) => {
  if (conversationId == null) return { conversation: null, channel: null };
  const conversation = await Conversation.findOne({ where: { id: conversationId, business_id: businessId } });
  if (!conversation) throw httpError(400, 'conversation_id is not a conversation of this business');
  const channel = (await inbox.platforms()).byId[conversation.social_platform_id] || null;
  return { conversation, channel };
};

/** The contact-book entry behind a WhatsApp conversation (matched by phone), if any. */
const contactOfConversation = async (businessId, conversation, channel) => {
  if (!conversation || channel !== 'whatsapp' || !conversation.contact_identifier) return null;
  return Contact.findOne({ where: { business_id: businessId, phone: conversation.contact_identifier }, attributes: ['id', 'name', 'phone'] });
};

const memberOrThrow = async (businessId, userId, field) => {
  if (userId == null) return;
  if (!(await inbox.isMember(businessId, userId))) throw httpError(400, `${field} must be a member of this business`);
};

/** Validated, de-duplicated tag ids of this business. */
const tagIdsFor = async (businessId, ids) => {
  if (ids === undefined) return undefined;
  const unique = [...new Set(ids.map(Number))];
  if (unique.length && (await Tag.count({ where: { id: unique, business_id: businessId } })) !== unique.length) {
    throw httpError(400, 'Every tag must belong to this business');
  }
  return unique;
};

/** Replace the tag set of one record in a join table (deal_tags / ticket_tags). */
const replaceTags = async (JoinModel, fk, id, tagIds, transaction) => {
  await JoinModel.destroy({ where: { [fk]: id }, transaction });
  if (tagIds.length) await JoinModel.bulkCreate(tagIds.map((tag_id) => ({ [fk]: id, tag_id })), { transaction });
};

module.exports = { USER_BRIEF, contactFor, conversationFor, contactOfConversation, memberOrThrow, tagIdsFor, replaceTags };
