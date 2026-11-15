'use strict';

const { Op, QueryTypes } = require('sequelize');
const {
  sequelize, Business, PipelineStage, Deal, DealTag, DealActivity, Contact, Tag, User,
} = require('../../models');
const realtime = require('../helpers/realtime');
const { requireUuid, httpError } = require('../helpers/uuid');
const links = require('./crmLinks');

// Every business starts with these columns (created on first use).
const DEFAULT_STAGES = [
  { name: 'New Enquiry', color: '#3b82f6', type: 'open' },
  { name: 'Qualified', color: '#8b5cf6', type: 'open' },
  { name: 'Negotiation', color: '#f59e0b', type: 'open' },
  { name: 'Booked', color: '#16a34a', type: 'won' },
  { name: 'Lost', color: '#dc2626', type: 'lost' },
];

const STAGE_BRIEF = ['id', 'uuid', 'name', 'color', 'type', 'position'];
const DAY = 24 * 3600 * 1000;

/** Create the default stages the first time a business uses the pipeline. */
const ensureStages = async (businessId) => {
  if (await PipelineStage.count({ where: { business_id: businessId } })) return;
  await sequelize.transaction(async (transaction) => {
    // Lock the business row so two first requests don't both seed.
    await Business.findByPk(businessId, { lock: transaction.LOCK.UPDATE, transaction, attributes: ['id'] });
    if (await PipelineStage.count({ where: { business_id: businessId }, transaction })) return;
    await PipelineStage.bulkCreate(DEFAULT_STAGES.map((s, i) => ({ ...s, business_id: businessId, position: i })), { transaction });
  });
};

const stageByUuid = async (businessId, uuid, field = 'stage_uuid', options = {}) => {
  const stage = await PipelineStage.findOne({ where: { uuid: requireUuid(uuid, field), business_id: businessId }, ...options });
  if (!stage) throw httpError(404, 'Stage not found');
  return stage;
};

const dealInclude = [
  { model: PipelineStage, as: 'stage', attributes: STAGE_BRIEF },
  { model: Contact, as: 'contact', attributes: ['id', 'name', 'phone'] },
  { model: User, as: 'owner', attributes: links.USER_BRIEF },
  { model: Tag, as: 'tags', attributes: ['id', 'uuid', 'name', 'color'], through: { attributes: [] } },
];

const formatDeal = (deal) => {
  const d = deal.toJSON();
  return {
    ...d,
    value: Number(d.value),
    days_in_stage: Math.floor((Date.now() - new Date(d.stage_entered_at).getTime()) / DAY),
  };
};

const dealByUuid = async (businessId, uuid, options = {}) => {
  const deal = await Deal.findOne({ where: { uuid: requireUuid(uuid), business_id: businessId }, ...options });
  if (!deal) throw httpError(404, 'Deal not found');
  return deal;
};

const loadDeal = async (id) => formatDeal(await Deal.findByPk(id, { include: dealInclude }));

const statusFor = (stage) => stage.type; // open | won | lost
const closeFields = (stage, lostReason) => ({
  status: statusFor(stage),
  closed_at: stage.type === 'open' ? null : new Date(),
  lost_reason: stage.type === 'lost' ? (lostReason ?? null) : null,
});

// ─── Stages ──────────────────────────────────────────────────────────────────

const listStages = async (businessId) => {
  await ensureStages(businessId);
  const stages = await PipelineStage.findAll({ where: { business_id: businessId }, order: [['position', 'ASC'], ['id', 'ASC']] });
  const totals = await sequelize.query(
    'SELECT stage_id, COUNT(*) AS count, COALESCE(SUM(value), 0) AS total_value FROM deals WHERE business_id = :businessId GROUP BY stage_id',
    { replacements: { businessId }, type: QueryTypes.SELECT }
  );
  const byStage = Object.fromEntries(totals.map((t) => [t.stage_id, t]));
  return stages.map((s) => ({ ...s.toJSON(), count: Number(byStage[s.id]?.count || 0), total_value: Number(byStage[s.id]?.total_value || 0) }));
};

const createStage = async (businessId, { name, color, type = 'open' }) => {
  await ensureStages(businessId);
  const position = ((await PipelineStage.max('position', { where: { business_id: businessId } })) ?? -1) + 1;
  return PipelineStage.create({ business_id: businessId, name, ...(color && { color }), type, position });
};

const updateStage = async (businessId, uuid, changes, userId) => {
  const stage = await stageByUuid(businessId, uuid, 'uuid');
  await sequelize.transaction(async (transaction) => {
    const typeChanged = changes.type && changes.type !== stage.type;
    await stage.update(changes, { transaction });
    // Deals take their status from the stage type.
    if (typeChanged) {
      await Deal.update(
        { status: stage.type, closed_at: stage.type === 'open' ? null : new Date(), ...(stage.type !== 'lost' && { lost_reason: null }) },
        { where: { stage_id: stage.id }, transaction }
      );
    }
  });
  if (userId) realtime.emitToBusiness(businessId, 'pipeline:stages_updated', { uuid: stage.uuid });
  return stage;
};

/** Delete a stage; its deals move to `moveTo` first (required when it has deals). */
const deleteStage = async (businessId, uuid, moveToUuid, userId) => {
  const stage = await stageByUuid(businessId, uuid, 'uuid');
  const total = await PipelineStage.count({ where: { business_id: businessId } });
  if (total <= 1) throw httpError(409, 'A pipeline needs at least one stage');

  const dealCount = await Deal.count({ where: { stage_id: stage.id } });
  let target = null;
  if (dealCount) {
    if (!moveToUuid) throw httpError(409, `Stage has ${dealCount} deal(s); pass move_to=<stage uuid> to move them first`);
    target = await stageByUuid(businessId, moveToUuid, 'move_to');
    if (target.id === stage.id) throw httpError(400, 'move_to must be a different stage');
  }

  await sequelize.transaction(async (transaction) => {
    if (target) {
      const deals = await Deal.findAll({ where: { stage_id: stage.id }, order: [['position', 'ASC']], transaction });
      let position = ((await Deal.max('position', { where: { stage_id: target.id }, transaction })) ?? -1) + 1;
      for (const deal of deals) {
        await deal.update({ stage_id: target.id, position: position++, stage_entered_at: new Date(), ...closeFields(target, deal.lost_reason) }, { transaction });
      }
      await DealActivity.bulkCreate(deals.map((d) => ({
        deal_id: d.id, user_id: userId, action: 'moved',
        from_value: { stage: stage.name, reason: 'stage deleted' }, to_value: { stage: target.name },
      })), { transaction });
    }
    await stage.destroy({ transaction });
    // Close the gap in positions.
    const rest = await PipelineStage.findAll({ where: { business_id: businessId }, order: [['position', 'ASC'], ['id', 'ASC']], transaction });
    for (const [i, s] of rest.entries()) if (s.position !== i) await s.update({ position: i }, { transaction });
  });
  realtime.emitToBusiness(businessId, 'pipeline:stages_updated', { deleted: stage.uuid, moved_to: target?.uuid || null });
  return { uuid: stage.uuid, moved_deals: dealCount, moved_to: target?.uuid || null };
};

/** uuids must list every stage of the business exactly once, in the new order. */
const reorderStages = async (businessId, uuids) => {
  await ensureStages(businessId);
  const wanted = uuids.map((u) => requireUuid(u, 'uuids'));
  const stages = await PipelineStage.findAll({ where: { business_id: businessId } });
  const byUuid = new Map(stages.map((s) => [s.uuid, s]));
  if (new Set(wanted).size !== wanted.length || wanted.length !== stages.length || wanted.some((u) => !byUuid.has(u))) {
    throw httpError(400, 'uuids must contain every stage of this business exactly once');
  }
  await sequelize.transaction(async (transaction) => {
    for (const [i, u] of wanted.entries()) await byUuid.get(u).update({ position: i }, { transaction });
  });
  realtime.emitToBusiness(businessId, 'pipeline:stages_updated', { reordered: true });
  return listStages(businessId);
};

// ─── Deals ───────────────────────────────────────────────────────────────────

/** Board: every stage with its deals (ordered by position), count and total value. */
const board = async (businessId, userId, query) => {
  await ensureStages(businessId);
  const where = { business_id: businessId };
  if (query.owner_id === 'me') where.owner_id = userId;
  else if (query.owner_id) where.owner_id = Number(query.owner_id);
  if (query.status) where.status = String(query.status).split(',');
  if (query.search) {
    const like = { [Op.like]: `%${query.search}%` };
    where[Op.or] = [{ title: like }, { company: like }, { '$contact.name$': like }, { '$contact.phone$': like }];
  }
  if (query.tag) {
    const tagIds = String(query.tag).split(',').map(Number).filter(Boolean);
    where.id = { [Op.in]: sequelize.literal(`(SELECT deal_id FROM deal_tags WHERE tag_id IN (${tagIds.map((t) => sequelize.escape(t)).join(',') || 'NULL'}))`) };
  }

  const [stages, deals] = await Promise.all([
    PipelineStage.findAll({ where: { business_id: businessId }, order: [['position', 'ASC'], ['id', 'ASC']] }),
    Deal.findAll({ where, include: dealInclude, order: [['position', 'ASC'], ['id', 'ASC']] }),
  ]);
  const byStage = new Map(stages.map((s) => [s.id, []]));
  deals.forEach((d) => byStage.get(d.stage_id)?.push(formatDeal(d)));
  return stages.map((s) => {
    const list = byStage.get(s.id);
    return { ...s.toJSON(), count: list.length, total_value: list.reduce((sum, d) => sum + d.value, 0), deals: list };
  });
};

const createDeal = async (businessId, userId, body) => {
  await ensureStages(businessId);
  const contact = await links.contactFor(businessId, body.contact_id);
  const { conversation, channel } = await links.conversationFor(businessId, body.conversation_id);
  if (!contact && !conversation) throw httpError(400, 'contact_id or conversation_id is required');
  const ownerId = body.owner_id ?? userId;
  await links.memberOrThrow(businessId, ownerId, 'owner_id');
  const tagIds = await links.tagIdsFor(businessId, body.tags);

  const stage = body.stage_uuid
    ? await stageByUuid(businessId, body.stage_uuid)
    : await PipelineStage.findOne({ where: { business_id: businessId, type: 'open' }, order: [['position', 'ASC']] });
  if (!stage) throw httpError(400, 'stage_uuid is required (no open stage exists)');

  const deal = await sequelize.transaction(async (transaction) => {
    const position = ((await Deal.max('position', { where: { stage_id: stage.id }, transaction })) ?? -1) + 1;
    const created = await Deal.create({
      business_id: businessId,
      title: body.title,
      contact_id: contact?.id ?? (await links.contactOfConversation(businessId, conversation, channel))?.id ?? null,
      conversation_id: conversation?.id ?? null,
      stage_id: stage.id,
      value: body.value ?? 0,
      currency: body.currency || 'usd',
      owner_id: ownerId,
      company: body.company ?? null,
      source_channel: body.source_channel || channel || 'manual',
      expected_close_date: body.expected_close_date ?? null,
      position,
      ...closeFields(stage, body.lost_reason),
      created_by: userId,
    }, { transaction });
    if (tagIds?.length) await links.replaceTags(DealTag, 'deal_id', created.id, tagIds, transaction);
    await DealActivity.create({ deal_id: created.id, user_id: userId, action: 'created', to_value: { stage: stage.name, value: created.value } }, { transaction });
    return created;
  });

  const full = await loadDeal(deal.id);
  realtime.emitToBusiness(businessId, 'deal:created', full);
  return full;
};

const getDeal = async (businessId, uuid) => formatDeal(await dealByUuid(businessId, uuid, { include: dealInclude }));

const DEAL_FIELDS = ['title', 'value', 'currency', 'owner_id', 'company', 'source_channel', 'expected_close_date', 'contact_id', 'conversation_id', 'lost_reason'];

const updateDeal = async (businessId, userId, uuid, body) => {
  const deal = await dealByUuid(businessId, uuid);
  if (body.owner_id !== undefined) await links.memberOrThrow(businessId, body.owner_id, 'owner_id');
  if (body.contact_id != null) await links.contactFor(businessId, body.contact_id);
  if (body.conversation_id != null) await links.conversationFor(businessId, body.conversation_id);
  const tagIds = await links.tagIdsFor(businessId, body.tags);

  const changes = {};
  const from = {};
  DEAL_FIELDS.forEach((f) => {
    if (body[f] !== undefined && String(body[f]) !== String(deal[f])) { from[f] = deal[f]; changes[f] = body[f]; }
  });

  await sequelize.transaction(async (transaction) => {
    if (Object.keys(changes).length) await deal.update(changes, { transaction });
    if (tagIds !== undefined) await links.replaceTags(DealTag, 'deal_id', deal.id, tagIds, transaction);
    if (Object.keys(changes).length || tagIds !== undefined) {
      await DealActivity.create({
        deal_id: deal.id, user_id: userId, action: 'updated',
        from_value: from, to_value: { ...changes, ...(tagIds !== undefined && { tags: tagIds }) },
      }, { transaction });
    }
  });
  const full = await loadDeal(deal.id);
  realtime.emitToBusiness(businessId, 'deal:updated', full);
  return full;
};

const deleteDeal = async (businessId, uuid) => {
  const deal = await dealByUuid(businessId, uuid);
  await deal.destroy();
  realtime.emitToBusiness(businessId, 'deal:deleted', { uuid: deal.uuid });
  return { uuid: deal.uuid };
};

/** Drag on the board: move to a stage (or within it) at a position; renumbers both columns. */
const moveDeal = async (businessId, userId, uuid, { stage_uuid, position, lost_reason }) => {
  const deal = await dealByUuid(businessId, uuid);
  const target = await stageByUuid(businessId, stage_uuid);
  const fromStage = await PipelineStage.findByPk(deal.stage_id);
  const stageChanged = target.id !== deal.stage_id;

  await sequelize.transaction(async (transaction) => {
    const column = await Deal.findAll({
      where: { stage_id: target.id, id: { [Op.ne]: deal.id } }, order: [['position', 'ASC'], ['id', 'ASC']], transaction,
    });
    const at = Math.min(Math.max(position ?? column.length, 0), column.length);
    column.splice(at, 0, deal);
    for (const [i, d] of column.entries()) {
      if (d.id === deal.id) {
        await deal.update({
          stage_id: target.id,
          position: i,
          ...(stageChanged && { stage_entered_at: new Date(), ...closeFields(target, lost_reason) }),
          ...(!stageChanged && target.type === 'lost' && lost_reason !== undefined && { lost_reason }),
        }, { transaction });
      } else if (d.position !== i) {
        await d.update({ position: i }, { transaction });
      }
    }
    if (stageChanged) {
      const old = await Deal.findAll({ where: { stage_id: fromStage.id }, order: [['position', 'ASC'], ['id', 'ASC']], transaction });
      for (const [i, d] of old.entries()) if (d.position !== i) await d.update({ position: i }, { transaction });
      await DealActivity.create({
        deal_id: deal.id, user_id: userId, action: 'moved',
        from_value: { stage: fromStage.name, stage_uuid: fromStage.uuid },
        to_value: { stage: target.name, stage_uuid: target.uuid, ...(target.type === 'lost' && { lost_reason: lost_reason ?? null }) },
      }, { transaction });
    }
  });

  const full = await loadDeal(deal.id);
  realtime.emitToBusiness(businessId, 'deal:moved', { deal: full, from_stage: fromStage.uuid, to_stage: target.uuid });
  return full;
};

const dealActivity = async (businessId, uuid) => {
  const deal = await dealByUuid(businessId, uuid);
  return DealActivity.findAll({
    where: { deal_id: deal.id },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    order: [['id', 'DESC']],
    limit: 200,
  });
};

const addDealNote = async (businessId, userId, uuid, text) => {
  const deal = await dealByUuid(businessId, uuid);
  const note = await DealActivity.create({ deal_id: deal.id, user_id: userId, action: 'note', to_value: { text } });
  realtime.emitToBusiness(businessId, 'deal:updated', { uuid: deal.uuid, note: true });
  return DealActivity.findByPk(note.id, { include: [{ model: User, as: 'user', attributes: ['id', 'name'] }] });
};

/** Stat cards. Won/lost/win-rate/avg-days use deals closed in [start, end). */
const summary = async (businessId, start, end) => {
  await ensureStages(businessId);
  const [row] = await sequelize.query(
    `SELECT
       SUM(status = 'open') AS open_count,
       COALESCE(SUM(CASE WHEN status = 'open' THEN value END), 0) AS open_value,
       SUM(status = 'won' AND closed_at >= :start AND closed_at < :end) AS won_count,
       COALESCE(SUM(CASE WHEN status = 'won' AND closed_at >= :start AND closed_at < :end THEN value END), 0) AS won_value,
       SUM(status = 'lost' AND closed_at >= :start AND closed_at < :end) AS lost_count,
       AVG(CASE WHEN status = 'won' AND closed_at >= :start AND closed_at < :end THEN TIMESTAMPDIFF(SECOND, created_at, closed_at) END) AS avg_seconds
     FROM deals WHERE business_id = :businessId`,
    { replacements: { businessId, start: utc(start), end: utc(end) }, type: QueryTypes.SELECT }
  );
  const won = Number(row.won_count) || 0;
  const lost = Number(row.lost_count) || 0;
  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    open_count: Number(row.open_count) || 0,
    open_value: Number(row.open_value),
    won_count: won,
    won_value: Number(row.won_value),
    lost_count: lost,
    win_rate: won + lost ? Number((won / (won + lost)).toFixed(4)) : null,
    avg_days_to_close: row.avg_seconds == null ? null : Number((Number(row.avg_seconds) / 86400).toFixed(1)),
  };
};

// Raw replacements format Date in the server's local zone; the DB session is UTC.
const utc = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');

/** Dashboard funnel: open deals per stage (all stages listed). */
const funnel = async (businessId) => {
  const stages = await listStages(businessId);
  const open = await sequelize.query(
    `SELECT stage_id, COUNT(*) AS count, COALESCE(SUM(value), 0) AS value FROM deals
     WHERE business_id = :businessId GROUP BY stage_id`,
    { replacements: { businessId }, type: QueryTypes.SELECT }
  );
  const by = Object.fromEntries(open.map((o) => [o.stage_id, o]));
  return stages.map((s) => ({ stage_uuid: s.uuid, name: s.name, type: s.type, count: Number(by[s.id]?.count || 0), value: Number(by[s.id]?.value || 0) }));
};

module.exports = {
  DEFAULT_STAGES, ensureStages, listStages, createStage, updateStage, deleteStage, reorderStages,
  board, createDeal, getDeal, updateDeal, deleteDeal, moveDeal, dealActivity, addDealNote, summary, funnel, utc,
};
