'use strict';

const Joi = require('joi');
const inbox = require('../services/inboxService');
const { Tag } = require('../../models');

const patchSchema = Joi.object({
  business_id: Joi.any(),
  business_uuid: Joi.any(), // consumed by authorizeBusiness.byUuid
  assigned_to: Joi.number().integer().positive().allow(null),
  status: Joi.string().valid('open', 'pending', 'resolved', 'snoozed'),
  snoozed_until: Joi.date().iso().allow(null),
  tags: Joi.array().items(Joi.number().integer().positive()).max(50),
}).or('assigned_to', 'status', 'snoozed_until', 'tags');

const noteSchema = Joi.object({
  business_id: Joi.any(),
  business_uuid: Joi.any(), // consumed by authorizeBusiness.byUuid
  text: Joi.string().trim().min(1).max(5000).required(),
  mentions: Joi.array().items(Joi.number().integer().positive()).max(50).default([]),
});

const bulkSchema = Joi.object({
  business_id: Joi.any(),
  business_uuid: Joi.any(), // consumed by authorizeBusiness.byUuid
  ids: Joi.array().items(Joi.number().integer().positive()).min(1).max(100).required(),
  action: Joi.string().valid('assign', 'resolve', 'reopen', 'read', 'unread', 'tag').required(),
  value: Joi.when('action', {
    is: 'tag',
    then: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
    otherwise: Joi.when('action', { is: 'assign', then: Joi.number().integer().positive().allow(null).required(), otherwise: Joi.any().strip() }),
  }),
});

const readSchema = Joi.object({
  business_id: Joi.any(),
  business_uuid: Joi.any(), // consumed by authorizeBusiness.byUuid
  last_read_message_id: Joi.number().integer().min(0),
});

const tagSchema = Joi.object({
  business_id: Joi.any(),
  business_uuid: Joi.any(), // consumed by authorizeBusiness.byUuid
  name: Joi.string().trim().min(1).max(50),
  color: Joi.string().trim().pattern(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).messages({ 'string.pattern.base': 'color must be a hex color like #7c3aed' }),
});

/** Wrap a handler: validation + error → { success:false, message } with the right status. */
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ success: false, message: 'Already exists' });
    console.error(`[inboxController] ${req.method} ${req.originalUrl} Error:`, err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const validate = (schema, body) => {
  const { error, value } = schema.validate(body || {}, { abortEarly: false });
  if (error) throw Object.assign(new Error(error.details.map((d) => d.message).join('; ')), { status: 400 });
  return value;
};

const ctx = (req) => ({ businessId: req.businessId, userId: req.user.id });

/** Tag addressed by its uuid, scoped to the caller's business. Throws 400 for a non-UUID. */
const tagWhere = (req) => {
  const { uuid } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw Object.assign(new Error('uuid must be a valid UUID'), { status: 400 });
  }
  // uuids are stored lowercase and the column compares case-sensitively.
  return { uuid: uuid.toLowerCase(), business_id: req.businessId };
};
const conversation = (req) => inbox.getConversation(Number(req.params.id), req.businessId);

module.exports = {
  // ── Conversations ─────────────────────────────────────────────────────────
  list: handle(async (req, res) => {
    const result = await inbox.listConversations({ ...ctx(req), query: req.query });
    res.json({ success: true, ...result });
  }),

  counts: handle(async (req, res) => {
    res.json({ success: true, data: await inbox.counts(ctx(req)) });
  }),

  get: handle(async (req, res) => {
    res.json({ success: true, data: await inbox.getOne(await conversation(req), req.user.id) });
  }),

  update: handle(async (req, res) => {
    const value = validate(patchSchema, req.body);
    res.json({ success: true, data: await inbox.updateConversation(await conversation(req), req.user.id, value) });
  }),

  messages: handle(async (req, res) => {
    const result = await inbox.listMessages(await conversation(req), req.query);
    res.json({ success: true, ...result });
  }),

  read: handle(async (req, res) => {
    const { last_read_message_id } = validate(readSchema, req.body);
    res.json({ success: true, data: await inbox.markRead(await conversation(req), req.user.id, last_read_message_id) });
  }),

  unread: handle(async (req, res) => {
    res.json({ success: true, data: await inbox.markUnread(await conversation(req), req.user.id) });
  }),

  readAll: handle(async (req, res) => {
    res.json({ success: true, data: await inbox.readAll({ ...ctx(req), channel: req.body.channel }) });
  }),

  bulk: handle(async (req, res) => {
    const value = validate(bulkSchema, req.body);
    res.json({ success: true, data: await inbox.bulk({ ...ctx(req), ...value }) });
  }),

  // ── Notes & activity ──────────────────────────────────────────────────────
  notes: handle(async (req, res) => {
    res.json({ success: true, data: await inbox.listNotes(await conversation(req)) });
  }),

  addNote: handle(async (req, res) => {
    const value = validate(noteSchema, req.body);
    res.status(201).json({ success: true, data: await inbox.addNote(await conversation(req), req.user.id, value) });
  }),

  activity: handle(async (req, res) => {
    res.json({ success: true, data: await inbox.listActivity(await conversation(req)) });
  }),

  // ── Tags (/api/v1/tags) ───────────────────────────────────────────────────
  listTags: handle(async (req, res) => {
    const rows = await Tag.findAll({ where: { business_id: req.businessId }, order: [['name', 'ASC']] });
    res.json({ success: true, data: rows, total: rows.length });
  }),

  createTag: handle(async (req, res) => {
    const value = validate(tagSchema.fork(['name'], (s) => s.required()), req.body);
    const tag = await Tag.create({ business_id: req.businessId, name: value.name, ...(value.color && { color: value.color }) });
    res.status(201).json({ success: true, data: tag });
  }),

  // PUT /api/v1/tags/:uuid
  updateTag: handle(async (req, res) => {
    const where = tagWhere(req);
    const value = validate(tagSchema.or('name', 'color'), req.body);
    const tag = await Tag.findOne({ where });
    if (!tag) return res.status(404).json({ success: false, message: 'Tag not found' });
    const { business_id, business_uuid, ...changes } = value;
    await tag.update(changes);
    res.json({ success: true, data: tag });
  }),

  // DELETE /api/v1/tags/:uuid
  deleteTag: handle(async (req, res) => {
    const where = tagWhere(req);
    const deleted = await Tag.destroy({ where });
    if (!deleted) return res.status(404).json({ success: false, message: 'Tag not found' });
    res.json({ success: true, data: { uuid: where.uuid } });
  }),
};
