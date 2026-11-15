'use strict';

const { Op, QueryTypes } = require('sequelize');
const db = require('../../models');
const realtime = require('../helpers/realtime');
const { requireUuid, httpError } = require('../helpers/uuid');
const links = require('./crmLinks');
const inbox = require('./inboxService');

const {
  sequelize, Business, Ticket, TicketCategory, SlaPolicy, TicketTag, TicketEvent, Contact, Tag, User,
} = db;

const FIRST_SEQ = 1001;
const PREFIX = 'TKT-';
const AT_RISK_SHARE = 0.25; // at risk once less than 25% of the SLA window is left
const OPEN_STATES = ['open', 'pending', 'on_hold'];
const DONE_STATES = ['resolved', 'closed'];

const ticketInclude = [
  { model: TicketCategory, as: 'category', attributes: ['id', 'uuid', 'name'] },
  { model: SlaPolicy, as: 'sla_policy', attributes: ['id', 'uuid', 'name', 'priority', 'first_response_minutes', 'resolution_minutes'] },
  { model: Contact, as: 'contact', attributes: ['id', 'name', 'phone'] },
  { model: User, as: 'assignee', attributes: links.USER_BRIEF },
  { model: User, as: 'creator', attributes: ['id', 'name'] },
  { model: Tag, as: 'tags', attributes: ['id', 'uuid', 'name', 'color'], through: { attributes: [] } },
];

const ticketByUuid = async (businessId, uuid, options = {}) => {
  const ticket = await Ticket.findOne({ where: { uuid: requireUuid(uuid), business_id: businessId }, ...options });
  if (!ticket) throw httpError(404, 'Ticket not found');
  return ticket;
};
const load = (id) => Ticket.findByPk(id, { include: ticketInclude });

const categoryByUuid = async (businessId, uuid) => {
  if (uuid == null) return null;
  const c = await TicketCategory.findOne({ where: { uuid: requireUuid(uuid, 'category_uuid'), business_id: businessId } });
  if (!c) throw httpError(400, 'category_uuid is not a category of this business');
  return c;
};

// ─── SLA ─────────────────────────────────────────────────────────────────────

/** Due dates from the business's policy for this priority (null when it has none). */
// shortcut: business_hours_only is treated as 24/7 until working hours exist (Settings module).
const slaFields = async (businessId, priority, from) => {
  const policy = await SlaPolicy.findOne({ where: { business_id: businessId, priority } });
  if (!policy) return { sla_policy_id: null, first_response_due_at: null, resolution_due_at: null };
  const start = new Date(from).getTime();
  return {
    sla_policy_id: policy.id,
    first_response_due_at: new Date(start + policy.first_response_minutes * 60000),
    resolution_due_at: new Date(start + policy.resolution_minutes * 60000),
  };
};

/** on_track | at_risk | breached | met (null without a policy). Pure, so it is unit-testable. */
const computeSlaStatus = (t, now = new Date()) => {
  if (!t.first_response_due_at && !t.resolution_due_at) return null;
  const at = (d) => (d ? new Date(d).getTime() : null);
  const respondedLate = t.first_responded_at && at(t.first_responded_at) > at(t.first_response_due_at);
  if (DONE_STATES.includes(t.status)) {
    const doneAt = at(t.resolved_at || t.closed_at) ?? now.getTime();
    return respondedLate || doneAt > at(t.resolution_due_at) ? 'breached' : 'met';
  }
  const nowMs = now.getTime();
  if (respondedLate || nowMs > at(t.resolution_due_at) || (!t.first_responded_at && nowMs > at(t.first_response_due_at))) return 'breached';
  // The tighter of the two running windows decides "at risk".
  const created = at(t.created_at) ?? nowMs;
  const windows = [[at(t.resolution_due_at)]];
  if (!t.first_responded_at) windows.push([at(t.first_response_due_at)]);
  const atRisk = windows.some(([due]) => due && (due - nowMs) <= (due - created) * AT_RISK_SHARE);
  return atRisk ? 'at_risk' : 'on_track';
};

/** For a ticket from a chat: the first agent reply in that conversation after the ticket opened. */
const firstReplyAt = async (ticket) => {
  if (!ticket.conversation_id) return null;
  const conv = await db.Conversation.findByPk(ticket.conversation_id, { attributes: ['id', 'social_platform_id'] });
  const channel = conv && (await inbox.platforms()).byId[conv.social_platform_id];
  if (!channel) return null;
  return db[inbox.CHANNELS[channel].model].min('created_at', {
    where: { conversation_id: conv.id, direction: 'outbound', created_at: { [Op.gte]: ticket.created_at } },
  });
};

// ─── Create ──────────────────────────────────────────────────────────────────

const createTicket = async (businessId, userId, body) => {
  const contact = await links.contactFor(businessId, body.contact_id);
  const { conversation, channel } = await links.conversationFor(businessId, body.conversation_id);
  if (!contact && !conversation) throw httpError(400, 'contact_id or conversation_id is required');
  await links.memberOrThrow(businessId, body.assignee_id, 'assignee_id');
  const category = await categoryByUuid(businessId, body.category_uuid);
  const tagIds = await links.tagIdsFor(businessId, body.tags);
  const priority = body.priority || 'medium';
  const now = new Date();

  const ticket = await sequelize.transaction(async (transaction) => {
    // Lock the business row so concurrent tickets get distinct numbers.
    await Business.findByPk(businessId, { lock: transaction.LOCK.UPDATE, transaction, attributes: ['id'] });
    const seq = ((await Ticket.max('seq', { where: { business_id: businessId }, transaction })) ?? FIRST_SEQ - 1) + 1;
    const sla = await slaFields(businessId, priority, now);
    const created = await Ticket.create({
      business_id: businessId,
      seq,
      number: `${PREFIX}${seq}`,
      subject: body.subject,
      description: body.description ?? null,
      contact_id: contact?.id ?? (await links.contactOfConversation(businessId, conversation, channel))?.id ?? null,
      conversation_id: conversation?.id ?? null,
      channel: body.channel || channel || 'manual',
      status: 'open',
      priority,
      category_id: category?.id ?? null,
      assignee_id: body.assignee_id ?? null,
      ...sla,
      sla_status: computeSlaStatus({ ...sla, status: 'open', created_at: now }, now),
      created_by: userId,
    }, { transaction });
    if (tagIds?.length) await links.replaceTags(TicketTag, 'ticket_id', created.id, tagIds, transaction);
    await TicketEvent.create({
      ticket_id: created.id, user_id: userId, type: 'created',
      to_value: { status: 'open', priority, ...(conversation && { conversation_id: conversation.id }) },
    }, { transaction });
    return created;
  });

  const full = await load(ticket.id);
  realtime.emitToBusiness(businessId, 'ticket:created', full);
  return full;
};

const fromConversation = (businessId, userId, { conversation_id, subject, priority, description, assignee_id, category_uuid }) =>
  createTicket(businessId, userId, { conversation_id, subject, priority, description, assignee_id, category_uuid });

// ─── Read ────────────────────────────────────────────────────────────────────

const SORTS = {
  created_desc: [['created_at', 'DESC'], ['id', 'DESC']],
  created_asc: [['created_at', 'ASC'], ['id', 'ASC']],
  updated_desc: [['updated_at', 'DESC'], ['id', 'DESC']],
  due_asc: [[sequelize.literal('resolution_due_at IS NULL'), 'ASC'], ['resolution_due_at', 'ASC'], ['id', 'ASC']],
  priority: [[sequelize.literal("FIELD(`Ticket`.`priority`, 'urgent', 'high', 'medium', 'low')"), 'ASC'], ['created_at', 'DESC']],
};

const listTickets = async (businessId, userId, q) => {
  const where = { business_id: businessId };
  const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (q.status) where.status = list(q.status);
  if (q.priority) where.priority = list(q.priority);
  if (q.channel) where.channel = list(q.channel);
  if (q.sla_status) where.sla_status = list(q.sla_status);
  if (q.assignee_id === 'me') where.assignee_id = userId;
  else if (q.assignee_id === 'unassigned') where.assignee_id = null;
  else if (q.assignee_id) where.assignee_id = Number(q.assignee_id);
  if (q.category_uuid) where.category_id = (await categoryByUuid(businessId, q.category_uuid)).id;
  if (q.search) {
    const like = { [Op.like]: `%${q.search}%` };
    where[Op.or] = [{ subject: like }, { number: like }, { description: like }];
  }
  const order = SORTS[q.sort || 'created_desc'];
  if (!order) throw httpError(400, `sort must be one of ${Object.keys(SORTS).join(', ')}`);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);

  const { count, rows } = await Ticket.findAndCountAll({ where, include: ticketInclude, order, limit, offset, distinct: true });
  return { data: rows, total: count };
};

const stats = async (businessId) => {
  const today = new Date(new Date().toISOString().slice(0, 10)); // UTC midnight
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [row] = await sequelize.query(
    `SELECT
       SUM(status = 'open') AS open, SUM(status = 'pending') AS pending, SUM(status = 'on_hold') AS on_hold,
       SUM(resolved_at >= :today) AS resolved_today,
       SUM(sla_status = 'breached' AND status IN ('open', 'pending', 'on_hold')) AS breaching,
       SUM(sla_status = 'at_risk' AND status IN ('open', 'pending', 'on_hold')) AS at_risk,
       AVG(CASE WHEN created_at >= :since AND first_responded_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, created_at, first_responded_at) END) AS frt,
       AVG(CASE WHEN created_at >= :since AND resolved_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, created_at, resolved_at) END) AS rt
     FROM tickets WHERE business_id = :businessId`,
    { replacements: { businessId, today: inbox.utc(today), since: inbox.utc(since) }, type: QueryTypes.SELECT }
  );
  const n = (v) => Number(v) || 0;
  return {
    open: n(row.open), pending: n(row.pending), on_hold: n(row.on_hold), resolved_today: n(row.resolved_today),
    breaching: n(row.breaching), at_risk: n(row.at_risk),
    avg_first_response_seconds: row.frt == null ? null : Math.round(row.frt),
    avg_resolution_seconds: row.rt == null ? null : Math.round(row.rt),
  };
};

const getTicket = async (businessId, uuid) => ticketByUuid(businessId, uuid, { include: ticketInclude });

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * One path for PUT and PATCH. Every change is written to the timeline.
 * status → resolved/closed stamps resolved_at/closed_at (reopening clears them);
 * priority → re-picks the SLA policy (dues counted from the ticket's creation).
 */
const updateTicket = async (businessId, userId, uuid, body) => {
  const ticket = await ticketByUuid(businessId, uuid);
  const events = [];
  const set = {};
  const now = new Date();

  for (const f of ['subject', 'description', 'channel']) {
    if (body[f] !== undefined && body[f] !== ticket[f]) set[f] = body[f];
  }
  if (Object.keys(set).length) events.push({ type: 'updated', from_value: Object.fromEntries(Object.keys(set).map((k) => [k, ticket[k]])), to_value: { ...set } });

  if (body.contact_id !== undefined && body.contact_id !== ticket.contact_id) {
    await links.contactFor(businessId, body.contact_id);
    set.contact_id = body.contact_id;
  }
  if (body.assignee_id !== undefined && body.assignee_id !== ticket.assignee_id) {
    await links.memberOrThrow(businessId, body.assignee_id, 'assignee_id');
    set.assignee_id = body.assignee_id;
    events.push({ type: 'assigned', from_value: ticket.assignee_id, to_value: body.assignee_id });
  }
  if (body.category_uuid !== undefined) {
    const category = await categoryByUuid(businessId, body.category_uuid);
    if ((category?.id ?? null) !== ticket.category_id) {
      set.category_id = category?.id ?? null;
      events.push({ type: 'category', from_value: ticket.category_id, to_value: category ? { uuid: category.uuid, name: category.name } : null });
    }
  }
  if (body.priority && body.priority !== ticket.priority) {
    Object.assign(set, { priority: body.priority }, await slaFields(businessId, body.priority, ticket.created_at));
    events.push({ type: 'priority', from_value: ticket.priority, to_value: body.priority });
  }
  if (body.status && body.status !== ticket.status) {
    set.status = body.status;
    if (body.status === 'resolved') { set.resolved_at = now; set.closed_at = null; }
    else if (body.status === 'closed') { set.closed_at = now; set.resolved_at = ticket.resolved_at || now; }
    else { set.resolved_at = null; set.closed_at = null; }
    // An agent acting on the ticket counts as the first response.
    if (!ticket.first_responded_at && body.status !== 'open') set.first_responded_at = now;
    events.push({ type: 'status', from_value: ticket.status, to_value: body.status });
  }
  if (body.csat_score !== undefined) {
    const status = set.status || ticket.status;
    if (body.csat_score !== null && !DONE_STATES.includes(status)) throw httpError(400, 'csat_score can be set only on a resolved or closed ticket');
    set.csat_score = body.csat_score;
    events.push({ type: 'csat', from_value: ticket.csat_score, to_value: body.csat_score });
  }
  const tagIds = await links.tagIdsFor(businessId, body.tags);
  if (tagIds !== undefined) events.push({ type: 'tags', to_value: tagIds });

  await sequelize.transaction(async (transaction) => {
    if (Object.keys(set).length) {
      await ticket.update(set, { transaction });
      await ticket.update({ sla_status: computeSlaStatus(ticket, now) }, { transaction });
    }
    if (tagIds !== undefined) await links.replaceTags(TicketTag, 'ticket_id', ticket.id, tagIds, transaction);
    if (events.length) await TicketEvent.bulkCreate(events.map((e) => ({ ...e, ticket_id: ticket.id, user_id: userId })), { transaction });
  });

  const full = await load(ticket.id);
  if (events.length) realtime.emitToBusiness(businessId, 'ticket:updated', full);
  return full;
};

const deleteTicket = async (businessId, uuid) => {
  const ticket = await ticketByUuid(businessId, uuid);
  await ticket.destroy();
  realtime.emitToBusiness(businessId, 'ticket:deleted', { uuid: ticket.uuid });
  return { uuid: ticket.uuid };
};

// ─── Timeline ────────────────────────────────────────────────────────────────

/** Events (notes, status changes, …) and, for a ticket from a chat, that chat's messages since it opened. Oldest first. */
const timeline = async (businessId, uuid) => {
  const ticket = await ticketByUuid(businessId, uuid);
  const events = await TicketEvent.findAll({
    where: { ticket_id: ticket.id }, include: [{ model: User, as: 'user', attributes: ['id', 'name'] }], order: [['id', 'ASC']],
  });
  const items = events.map((e) => ({ kind: e.type === 'note' ? 'note' : 'event', created_at: e.created_at, ...e.toJSON() }));

  if (ticket.conversation_id) {
    const conv = await db.Conversation.findByPk(ticket.conversation_id);
    const channel = conv && (await inbox.platforms()).byId[conv.social_platform_id];
    if (channel) {
      const rows = await db[inbox.CHANNELS[channel].model].findAll({
        where: { conversation_id: conv.id, created_at: { [Op.gte]: ticket.created_at } }, order: [['id', 'ASC']], limit: 500,
      });
      rows.forEach((m) => items.push({ kind: 'message', ...inbox.formatMessage(channel, m) }));
    }
  }
  items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return { ticket: { uuid: ticket.uuid, number: ticket.number }, items };
};

const addNote = async (businessId, userId, uuid, text) => {
  const ticket = await ticketByUuid(businessId, uuid);
  const event = await TicketEvent.create({ ticket_id: ticket.id, user_id: userId, type: 'note', body: text });
  realtime.emitToBusiness(businessId, 'ticket:updated', { uuid: ticket.uuid, note: true });
  return TicketEvent.findByPk(event.id, { include: [{ model: User, as: 'user', attributes: ['id', 'name'] }] });
};

// ─── Job ─────────────────────────────────────────────────────────────────────

/** Recompute SLA for running tickets; record and announce new breaches. Returns tickets changed. */
const refreshSla = async () => {
  const running = await Ticket.findAll({ where: { status: OPEN_STATES, sla_policy_id: { [Op.ne]: null } }, limit: 1000 });
  let changed = 0;
  for (const t of running) {
    const patch = {};
    if (!t.first_responded_at) {
      const replied = await firstReplyAt(t);
      if (replied) patch.first_responded_at = replied;
    }
    const next = computeSlaStatus({ ...t.toJSON(), ...patch });
    if (next !== t.sla_status) patch.sla_status = next;
    if (!Object.keys(patch).length) continue;
    await t.update(patch);
    changed++;
    if (patch.sla_status === 'breached') {
      await TicketEvent.create({ ticket_id: t.id, type: 'sla_breached', from_value: null, to_value: { resolution_due_at: t.resolution_due_at } });
      realtime.emitToBusiness(t.business_id, 'ticket:sla_breached', { uuid: t.uuid, number: t.number, assignee_id: t.assignee_id });
    }
    realtime.emitToBusiness(t.business_id, 'ticket:updated', { uuid: t.uuid, sla_status: t.sla_status });
  }
  return changed;
};

/** Dashboard: tickets each agent resolved in [start, end). */
const resolvedByAgent = async (businessId, start, end) => {
  const rows = await sequelize.query(
    `SELECT assignee_id, COUNT(*) AS n FROM tickets
     WHERE business_id = :businessId AND assignee_id IS NOT NULL AND resolved_at >= :start AND resolved_at < :end
     GROUP BY assignee_id`,
    { replacements: { businessId, start: inbox.utc(start), end: inbox.utc(end) }, type: QueryTypes.SELECT }
  );
  return Object.fromEntries(rows.map((r) => [r.assignee_id, Number(r.n)]));
};

// ─── Categories & SLA policies ───────────────────────────────────────────────

const simpleCrud = (Model, label) => ({
  list: (businessId) => Model.findAll({ where: { business_id: businessId }, order: [['id', 'ASC']] }),
  create: (businessId, data) => Model.create({ ...data, business_id: businessId }),
  update: async (businessId, uuid, data) => {
    const row = await Model.findOne({ where: { uuid: requireUuid(uuid), business_id: businessId } });
    if (!row) throw httpError(404, `${label} not found`);
    return row.update(data);
  },
  remove: async (businessId, uuid) => {
    const row = await Model.findOne({ where: { uuid: requireUuid(uuid), business_id: businessId } });
    if (!row) throw httpError(404, `${label} not found`);
    await row.destroy();
    return { uuid: row.uuid };
  },
});

module.exports = {
  createTicket, fromConversation, listTickets, stats, getTicket, updateTicket, deleteTicket, timeline, addNote,
  refreshSla, resolvedByAgent, computeSlaStatus,
  categories: simpleCrud(TicketCategory, 'Category'),
  slaPolicies: simpleCrud(SlaPolicy, 'SLA policy'),
};
