'use strict';

/**
 * Pipeline (stages + deals) and Tickets (+ categories, SLA policies).
 * Routes use authorizeBusiness.byUuid, so req.businessId is set from business_uuid.
 */
const Joi = require('joi');
const pipeline = require('../services/pipelineService');
const tickets = require('../services/ticketService');
const { _internals: { parseRange } } = require('../services/dashboardService');

const scope = { business_uuid: Joi.any(), business_id: Joi.any() }; // consumed by the business guard
const color = Joi.string().trim().pattern(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).messages({ 'string.pattern.base': 'color must be a hex color like #7c3aed' });
const userId = Joi.number().integer().positive().allow(null);
const tagIds = Joi.array().items(Joi.number().integer().positive()).max(50);
const PRIORITY = ['low', 'medium', 'high', 'urgent'];

const S = {
  stageCreate: Joi.object({ ...scope, name: Joi.string().trim().min(1).max(60).required(), color, type: Joi.string().valid('open', 'won', 'lost') }),
  stageUpdate: Joi.object({ ...scope, name: Joi.string().trim().min(1).max(60), color, type: Joi.string().valid('open', 'won', 'lost') }).or('name', 'color', 'type'),
  reorder: Joi.object({ ...scope, uuids: Joi.array().items(Joi.string()).min(1).required() }),
  dealCreate: Joi.object({
    ...scope,
    title: Joi.string().trim().min(1).max(255).required(),
    contact_id: Joi.number().integer().positive(),
    conversation_id: Joi.number().integer().positive(),
    stage_uuid: Joi.string(),
    value: Joi.number().min(0).precision(2),
    currency: Joi.string().trim().length(3).lowercase(),
    owner_id: userId,
    company: Joi.string().trim().max(255).allow('', null),
    tags: tagIds,
    source_channel: Joi.string().valid('whatsapp', 'instagram', 'messenger', 'manual'),
    expected_close_date: Joi.date().iso().allow(null),
    lost_reason: Joi.string().trim().max(2000).allow('', null),
  }),
  dealUpdate: Joi.object({
    ...scope,
    title: Joi.string().trim().min(1).max(255),
    contact_id: Joi.number().integer().positive().allow(null),
    conversation_id: Joi.number().integer().positive().allow(null),
    value: Joi.number().min(0).precision(2),
    currency: Joi.string().trim().length(3).lowercase(),
    owner_id: userId,
    company: Joi.string().trim().max(255).allow('', null),
    tags: tagIds,
    source_channel: Joi.string().valid('whatsapp', 'instagram', 'messenger', 'manual'),
    expected_close_date: Joi.date().iso().allow(null),
    lost_reason: Joi.string().trim().max(2000).allow('', null),
  }).min(1),
  dealMove: Joi.object({ ...scope, stage_uuid: Joi.string().required(), position: Joi.number().integer().min(0), lost_reason: Joi.string().trim().max(2000).allow('', null) }),
  note: Joi.object({ ...scope, text: Joi.string().trim().min(1).max(5000).required() }),
  ticketCreate: Joi.object({
    ...scope,
    subject: Joi.string().trim().min(1).max(255).required(),
    description: Joi.string().trim().max(20000).allow('', null),
    contact_id: Joi.number().integer().positive(),
    conversation_id: Joi.number().integer().positive(),
    channel: Joi.string().valid('whatsapp', 'instagram', 'messenger', 'email', 'manual'),
    priority: Joi.string().valid(...PRIORITY),
    category_uuid: Joi.string().allow(null),
    assignee_id: userId,
    tags: tagIds,
  }),
  fromConversation: Joi.object({
    ...scope,
    conversation_id: Joi.number().integer().positive().required(),
    subject: Joi.string().trim().min(1).max(255).required(),
    priority: Joi.string().valid(...PRIORITY),
    description: Joi.string().trim().max(20000).allow('', null),
    assignee_id: userId,
    category_uuid: Joi.string().allow(null),
  }),
  ticketUpdate: Joi.object({
    ...scope,
    subject: Joi.string().trim().min(1).max(255),
    description: Joi.string().trim().max(20000).allow('', null),
    contact_id: Joi.number().integer().positive().allow(null),
    channel: Joi.string().valid('whatsapp', 'instagram', 'messenger', 'email', 'manual'),
    status: Joi.string().valid('open', 'pending', 'on_hold', 'resolved', 'closed'),
    priority: Joi.string().valid(...PRIORITY),
    category_uuid: Joi.string().allow(null),
    assignee_id: userId,
    tags: tagIds,
    csat_score: Joi.number().integer().min(1).max(5).allow(null),
  }).min(1),
  category: Joi.object({ ...scope, name: Joi.string().trim().min(1).max(60).required() }),
  slaCreate: Joi.object({
    ...scope,
    name: Joi.string().trim().min(1).max(60).required(),
    priority: Joi.string().valid(...PRIORITY).required(),
    first_response_minutes: Joi.number().integer().min(1).required(),
    resolution_minutes: Joi.number().integer().min(1).required(),
    business_hours_only: Joi.boolean(),
  }),
  slaUpdate: Joi.object({
    ...scope,
    name: Joi.string().trim().min(1).max(60),
    priority: Joi.string().valid(...PRIORITY),
    first_response_minutes: Joi.number().integer().min(1),
    resolution_minutes: Joi.number().integer().min(1),
    business_hours_only: Joi.boolean(),
  }).min(1),
};

/** Validate the body (if a schema is given) and strip the business scope keys. */
const body = (schema, req) => {
  const { error, value } = schema.validate(req.body || {}, { abortEarly: false });
  if (error) throw Object.assign(new Error('Validation failed'), { status: 400, details: error.details.map((d) => d.message) });
  const { business_uuid, business_id, ...rest } = value;
  return rest;
};

const handle = (fn, status = 200) => async (req, res) => {
  try {
    const result = await fn(req);
    res.status(status).json({ success: true, ...(result && result.__raw ? result.__raw : { data: result }) });
  } catch (err) {
    const code = err.status || err.statusCode;
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ success: false, message: 'Already exists' });
    if (code && code < 500) return res.status(code).json({ success: false, message: err.message, ...(err.details && { details: err.details }) });
    console.error(`[crmController] ${req.method} ${req.originalUrl} Error:`, err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
const raw = (obj) => ({ __raw: obj });

const b = (req) => req.businessId;
const u = (req) => req.user.id;
const range = (req) => { const r = parseRange(req.query); return [r.start, r.end]; };

module.exports = {
  // ── Pipeline stages ──
  listStages: handle((req) => pipeline.listStages(b(req))),
  createStage: handle((req) => pipeline.createStage(b(req), body(S.stageCreate, req)), 201),
  updateStage: handle((req) => pipeline.updateStage(b(req), req.params.uuid, body(S.stageUpdate, req), u(req))),
  deleteStage: handle((req) => pipeline.deleteStage(b(req), req.params.uuid, req.query.move_to, u(req))),
  reorderStages: handle((req) => pipeline.reorderStages(b(req), body(S.reorder, req).uuids)),
  pipelineSummary: handle((req) => pipeline.summary(b(req), ...range(req))),

  // ── Deals ──
  board: handle((req) => pipeline.board(b(req), u(req), req.query)),
  createDeal: handle((req) => pipeline.createDeal(b(req), u(req), body(S.dealCreate, req)), 201),
  getDeal: handle((req) => pipeline.getDeal(b(req), req.params.uuid)),
  updateDeal: handle((req) => pipeline.updateDeal(b(req), u(req), req.params.uuid, body(S.dealUpdate, req))),
  deleteDeal: handle((req) => pipeline.deleteDeal(b(req), req.params.uuid)),
  moveDeal: handle((req) => pipeline.moveDeal(b(req), u(req), req.params.uuid, body(S.dealMove, req))),
  dealActivity: handle((req) => pipeline.dealActivity(b(req), req.params.uuid)),
  addDealNote: handle((req) => pipeline.addDealNote(b(req), u(req), req.params.uuid, body(S.note, req).text), 201),

  // ── Tickets ──
  listTickets: handle(async (req) => raw(await tickets.listTickets(b(req), u(req), req.query))),
  ticketStats: handle((req) => tickets.stats(b(req))),
  createTicket: handle((req) => tickets.createTicket(b(req), u(req), body(S.ticketCreate, req)), 201),
  fromConversation: handle((req) => tickets.fromConversation(b(req), u(req), body(S.fromConversation, req)), 201),
  getTicket: handle((req) => tickets.getTicket(b(req), req.params.uuid)),
  updateTicket: handle((req) => tickets.updateTicket(b(req), u(req), req.params.uuid, body(S.ticketUpdate, req))),
  deleteTicket: handle((req) => tickets.deleteTicket(b(req), req.params.uuid)),
  timeline: handle((req) => tickets.timeline(b(req), req.params.uuid)),
  addTicketNote: handle((req) => tickets.addNote(b(req), u(req), req.params.uuid, body(S.note, req).text), 201),

  // ── Categories & SLA policies ──
  listCategories: handle((req) => tickets.categories.list(b(req))),
  createCategory: handle((req) => tickets.categories.create(b(req), body(S.category, req)), 201),
  updateCategory: handle((req) => tickets.categories.update(b(req), req.params.uuid, body(S.category, req))),
  deleteCategory: handle((req) => tickets.categories.remove(b(req), req.params.uuid)),
  listSla: handle((req) => tickets.slaPolicies.list(b(req))),
  createSla: handle((req) => tickets.slaPolicies.create(b(req), body(S.slaCreate, req)), 201),
  updateSla: handle((req) => tickets.slaPolicies.update(b(req), req.params.uuid, body(S.slaUpdate, req))),
  deleteSla: handle((req) => tickets.slaPolicies.remove(b(req), req.params.uuid)),
};
