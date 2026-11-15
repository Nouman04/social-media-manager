'use strict';

const { QueryTypes, Op } = require('sequelize');
const db = require('../../models');
const realtime = require('../helpers/realtime');

const {
  sequelize, Conversation, ConversationRead, ConversationNote, ConversationActivity,
  ConversationTag, Tag, User, Contact, Business, BusinessUser, SocialPlatform,
} = db;

// Channel → its message table / model. conversation.social_platform_id picks one.
const CHANNELS = {
  whatsapp: { table: 'whatsapp_messages', model: 'WhatsappMessage' },
  instagram: { table: 'instagram_messages', model: 'InstagramMessage' },
  messenger: { table: 'messenger_messages', model: 'MessengerMessage' },
};
const STATUSES = ['open', 'pending', 'resolved', 'snoozed'];

// Unread for the caller: newest inbound message is past their read point.
const UNREAD_SQL = '(c.last_inbound_message_id IS NOT NULL AND c.last_inbound_message_id > COALESCE(cr.last_read_message_id, 0))';

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Raw-query replacements format Date in the *server's local* zone, but the DB
// session is UTC. Always pass datetimes as UTC strings.
const utc = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');

let platformCache = null;
const platforms = async () => {
  if (platformCache) return platformCache;
  const rows = await SocialPlatform.findAll({ where: { name: Object.keys(CHANNELS) }, attributes: ['id', 'name'] });
  const cache = { byName: {}, byId: {} };
  rows.forEach((r) => { cache.byName[r.name] = r.id; cache.byId[r.id] = r.name; });
  platformCache = cache;
  return cache;
};

/** Comma list of channels → valid channel names (all three when empty). */
const parseChannels = (value) => {
  if (!value) return Object.keys(CHANNELS);
  const list = String(value).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = list.filter((c) => !CHANNELS[c]);
  if (bad.length) throw httpError(400, `Unknown channel: ${bad.join(', ')}`);
  return list;
};

const encodeCursor = (values) => Buffer.from(JSON.stringify(values)).toString('base64url');
const decodeCursor = (cursor) => {
  try {
    const v = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw httpError(400, 'Invalid cursor');
  }
};

// Keyset sort definitions: [sql expression, direction, isDate, row field]
const SORTS = {
  last_message_desc: [['c.last_message_at', 'DESC', true, 'last_message_at'], ['c.id', 'DESC', false, 'id']],
  last_message_asc: [['c.last_message_at', 'ASC', true, 'last_message_at'], ['c.id', 'ASC', false, 'id']],
  created_desc: [['c.created_at', 'DESC', true, 'created_at'], ['c.id', 'DESC', false, 'id']],
  unread_first: [[UNREAD_SQL, 'DESC', false, 'is_unread'], ['c.last_message_at', 'DESC', true, 'last_message_at'], ['c.id', 'DESC', false, 'id']],
};

/** (k1 op v1) OR (k1 = v1 AND ((k2 op v2) OR (k2 = v2 AND ...))) */
const keysetCondition = (keys, values, replacements) => {
  const build = (i) => {
    const [expr, dir, isDate] = keys[i];
    const name = `cur${i}`;
    replacements[name] = isDate ? utc(values[i]) : values[i];
    const op = dir === 'DESC' ? '<' : '>';
    if (i === keys.length - 1) return `${expr} ${op} :${name}`;
    return `(${expr} ${op} :${name} OR (${expr} = :${name} AND ${build(i + 1)}))`;
  };
  return build(0);
};

// ─── Message formatting (one shape for all channels) ─────────────────────────

const TYPE_MAP = { file: 'document', share: 'text', story_reply: 'text', quick_reply: 'text', postback: 'text' };

const messageText = (row) => {
  const p = row.payload || {};
  const media = p[row.message_type];
  return p.text?.body
    ?? p.message?.text
    ?? media?.caption
    ?? p.postback?.title
    ?? (row.message_type === 'template' ? (p.template?.name || null) : null);
};

const mediaUrl = (row) => {
  const p = row.payload || {};
  const media = p[row.message_type];
  const attachment = p.message?.attachment || (Array.isArray(p.message?.attachments) ? p.message.attachments[0] : null);
  return media?.local_url || media?.link || attachment?.payload?.url || null;
};

const formatMessage = (channel, row, usersById = {}) => {
  const m = row.toJSON ? row.toJSON() : row;
  let sender;
  if (m.direction === 'inbound') sender = { type: 'customer' };
  else if (m.sender_id) sender = { type: 'user', id: m.sender_id, name: usersById[m.sender_id]?.name || null };
  else sender = { type: 'system' };
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    channel,
    direction: m.direction,
    type: TYPE_MAP[m.message_type] || m.message_type,
    text: messageText(m),
    media_url: mediaUrl(m),
    status: m.status,
    error: m.error_message ? { code: m.error_code, message: m.error_message } : null,
    sender,
    reactions: [],
    created_at: m.created_at,
    payload: m.payload,
  };
};

// ─── Enrichment for a page of conversations ──────────────────────────────────

const enrich = async (rows, { userId, businessId }) => {
  if (!rows.length) return [];
  const { byId } = await platforms();
  const ids = rows.map((r) => r.id);
  const byChannel = {};
  rows.forEach((r) => { const ch = byId[r.social_platform_id]; if (ch) (byChannel[ch] ||= []).push(r.id); });

  const lastMessages = {};
  const unread = {};
  for (const [channel, convIds] of Object.entries(byChannel)) {
    const { table } = CHANNELS[channel];
    const last = await sequelize.query(
      `SELECT * FROM ${table} WHERE id IN (
         SELECT MAX(id) FROM ${table}
         WHERE conversation_id IN (:convIds) AND deleted_at IS NULL AND message_type <> 'reaction'
         GROUP BY conversation_id)`,
      { replacements: { convIds }, type: QueryTypes.SELECT }
    );
    last.forEach((m) => {
      if (typeof m.payload === 'string') { try { m.payload = JSON.parse(m.payload); } catch { /* keep raw */ } }
      lastMessages[m.conversation_id] = formatMessage(channel, m);
    });

    const counts = await sequelize.query(
      `SELECT m.conversation_id, COUNT(*) AS n FROM ${table} m
       LEFT JOIN conversation_reads cr ON cr.conversation_id = m.conversation_id AND cr.user_id = :userId
       WHERE m.conversation_id IN (:convIds) AND m.direction = 'inbound' AND m.deleted_at IS NULL
         AND m.message_type <> 'reaction' AND m.id > COALESCE(cr.last_read_message_id, 0)
       GROUP BY m.conversation_id`,
      { replacements: { convIds, userId }, type: QueryTypes.SELECT }
    );
    counts.forEach((c) => { unread[c.conversation_id] = Number(c.n); });
  }

  const assigneeIds = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean))];
  const assignees = assigneeIds.length
    ? Object.fromEntries((await User.findAll({ where: { id: assigneeIds }, attributes: ['id', 'name', 'avatar'] })).map((u) => [u.id, u]))
    : {};

  const tagRows = await sequelize.query(
    `SELECT ct.conversation_id, t.id, t.name, t.color FROM conversation_tags ct
     JOIN tags t ON t.id = ct.tag_id WHERE ct.conversation_id IN (:ids) ORDER BY t.name`,
    { replacements: { ids }, type: QueryTypes.SELECT }
  );
  const tags = {};
  tagRows.forEach(({ conversation_id, ...t }) => (tags[conversation_id] ||= []).push(t));

  // WhatsApp threads are keyed by phone — link them to the contact book.
  const phones = rows.filter((r) => byId[r.social_platform_id] === 'whatsapp').map((r) => r.contact_identifier).filter(Boolean);
  const contacts = phones.length
    ? Object.fromEntries((await Contact.findAll({ where: { business_id: businessId, phone: phones }, attributes: ['id', 'name', 'phone'] })).map((c) => [c.phone, c]))
    : {};

  return rows.map((r) => {
    const channel = byId[r.social_platform_id] || null;
    const isWa = channel === 'whatsapp';
    const contact = isWa ? contacts[r.contact_identifier] : null;
    const assignee = assignees[r.assigned_to];
    return {
      id: r.id,
      channel,
      account_id: r.account_id,
      status: r.status,
      assigned_to: assignee ? { id: assignee.id, name: assignee.name, avatar: assignee.avatar } : null,
      unread_count: unread[r.id] || 0,
      last_message: lastMessages[r.id] ? (({ payload, conversation_id, error, ...m }) => m)(lastMessages[r.id]) : null,
      last_message_at: r.last_message_at,
      last_inbound_at: r.last_inbound_at,
      snoozed_until: r.snoozed_until,
      contact: {
        id: contact?.id || null,
        name: contact?.name || r.contact_name || null,
        username: isWa ? null : r.contact_name || null,
        identifier: r.contact_identifier,
        phone: isWa ? r.contact_identifier : null,
        avatar_url: null,
      },
      tags: tags[r.id] || [],
      window_expires_at: isWa && r.last_inbound_at ? new Date(new Date(r.last_inbound_at).getTime() + 24 * 3600 * 1000) : null,
      created_at: r.created_at,
    };
  });
};

// ─── Queries ─────────────────────────────────────────────────────────────────

const baseWhere = async ({ businessId, userId, query }, replacements) => {
  const { byName } = await platforms();
  const where = ['c.business_id = :businessId'];
  replacements.businessId = businessId;
  replacements.userId = userId;

  const channels = parseChannels(query.channel);
  replacements.platformIds = channels.map((c) => byName[c]).filter(Boolean);
  if (!replacements.platformIds.length) replacements.platformIds = [0];
  where.push('c.social_platform_id IN (:platformIds)');

  if (query.account_id) { where.push('c.account_id = :accountId'); replacements.accountId = Number(query.account_id); }

  const status = query.status || 'open';
  if (status !== 'all') {
    const list = String(status).split(',').map((s) => s.trim());
    if (list.some((s) => !STATUSES.includes(s))) throw httpError(400, `status must be one of ${STATUSES.join(', ')}, all`);
    where.push('c.status IN (:statuses)');
    replacements.statuses = list;
  }

  const assigned = query.assigned_to;
  if (assigned && assigned !== 'all') {
    if (assigned === 'me') where.push('c.assigned_to = :userId');
    else if (assigned === 'unassigned') where.push('c.assigned_to IS NULL');
    else if (/^\d+$/.test(assigned)) { where.push('c.assigned_to = :assignedTo'); replacements.assignedTo = Number(assigned); }
    else throw httpError(400, 'assigned_to must be me, unassigned, all or a user id');
  }

  if (query.unread === 'true' || query.unread === true) where.push(UNREAD_SQL);

  if (query.tag) {
    replacements.tagIds = String(query.tag).split(',').map(Number).filter(Boolean);
    if (replacements.tagIds.length) {
      where.push('EXISTS (SELECT 1 FROM conversation_tags ct WHERE ct.conversation_id = c.id AND ct.tag_id IN (:tagIds))');
    }
  }

  if (query.search) {
    // shortcut: matches contact name / identifier only, not last message text; add a FULLTEXT index on messages if needed.
    replacements.search = `%${String(query.search).trim()}%`;
    where.push('(c.contact_name LIKE :search OR c.contact_identifier LIKE :search)');
  }
  return where;
};

const FROM_SQL = `FROM conversations c
  LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = :userId`;

const listConversations = async ({ businessId, userId, query }) => {
  const sortName = query.sort || 'last_message_desc';
  const keys = SORTS[sortName];
  if (!keys) throw httpError(400, `sort must be one of ${Object.keys(SORTS).join(', ')}`);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 100);

  const replacements = {};
  const where = await baseWhere({ businessId, userId, query }, replacements);
  if (query.cursor) {
    const values = decodeCursor(query.cursor);
    if (values.length !== keys.length) throw httpError(400, 'Cursor does not match sort');
    where.push(keysetCondition(keys, values, replacements));
  }
  replacements.limit = limit + 1;

  const rows = await sequelize.query(
    `SELECT c.id, c.social_platform_id, c.account_id, c.contact_identifier, c.contact_name, c.status,
            c.assigned_to, c.snoozed_until, c.last_message_at, c.last_inbound_at, c.created_at,
            ${UNREAD_SQL} AS is_unread
     ${FROM_SQL}
     WHERE ${where.join(' AND ')}
     ORDER BY ${keys.map(([expr, dir]) => `${expr} ${dir}`).join(', ')}
     LIMIT :limit`,
    { replacements, type: QueryTypes.SELECT }
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor(keys.map(([, , isDate, field]) => (isDate ? new Date(last[field]).toISOString() : Number(last[field]))))
    : null;

  return { data: await enrich(page, { userId, businessId }), next_cursor: nextCursor, has_more: hasMore };
};

const counts = async ({ businessId, userId }) => {
  const { byId } = await platforms();
  const replacements = {};
  const where = await baseWhere({ businessId, userId, query: { status: 'all' } }, replacements);
  const rows = await sequelize.query(
    `SELECT c.social_platform_id AS pid, c.status, COUNT(*) AS total,
            SUM(${UNREAD_SQL} AND c.status <> 'resolved') AS unread,
            SUM(c.assigned_to = :userId AND c.status <> 'resolved') AS mine,
            SUM(c.assigned_to IS NULL AND c.status <> 'resolved') AS unassigned
     ${FROM_SQL}
     WHERE ${where.join(' AND ')}
     GROUP BY c.social_platform_id, c.status`,
    { replacements, type: QueryTypes.SELECT }
  );

  const result = {
    all: 0, unread: 0, mine: 0, unassigned: 0,
    by_channel: Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, { total: 0, unread: 0 }])),
    by_status: Object.fromEntries(STATUSES.map((s) => [s, 0])),
  };
  rows.forEach((r) => {
    const total = Number(r.total); const un = Number(r.unread) || 0;
    result.all += total;
    result.unread += un;
    result.mine += Number(r.mine) || 0;
    result.unassigned += Number(r.unassigned) || 0;
    result.by_status[r.status] = (result.by_status[r.status] || 0) + total;
    const ch = result.by_channel[byId[r.pid]];
    if (ch) { ch.total += total; ch.unread += un; }
  });
  return result;
};

const emitCounts = async (businessId, userId) => {
  try {
    realtime.emitToBusiness(businessId, 'inbox:counts', { user_id: userId, ...(await counts({ businessId, userId })) });
  } catch (err) {
    console.warn('[inboxService.emitCounts] skipped:', err.message);
  }
};

const getConversation = async (id, businessId) => {
  const conv = await Conversation.findOne({ where: { id, business_id: businessId } });
  if (!conv) throw httpError(404, 'Conversation not found');
  return conv;
};

const channelOf = async (conv) => {
  const ch = (await platforms()).byId[conv.social_platform_id];
  if (!ch) throw httpError(400, 'Conversation is not on a supported inbox channel');
  return ch;
};

const getOne = async (conv, userId) => {
  const [row] = await sequelize.query(
    `SELECT c.*, ${UNREAD_SQL} AS is_unread ${FROM_SQL} WHERE c.id = :id`,
    { replacements: { id: conv.id, userId }, type: QueryTypes.SELECT }
  );
  const [item] = await enrich([row], { userId, businessId: conv.business_id });
  return item;
};

const listMessages = async (conv, { limit, before }) => {
  const channel = await channelOf(conv);
  const Model = db[CHANNELS[channel].model];
  const size = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const where = { conversation_id: conv.id };
  if (before) where.id = { [Op.lt]: Number(before) };

  const rows = await Model.findAll({ where, order: [['id', 'DESC']], limit: size + 1 });
  const hasMore = rows.length > size;
  const page = rows.slice(0, size).reverse();

  const senderIds = [...new Set(page.map((m) => m.sender_id).filter(Boolean))];
  const users = senderIds.length
    ? Object.fromEntries((await User.findAll({ where: { id: senderIds }, attributes: ['id', 'name'] })).map((u) => [u.id, u]))
    : {};

  return {
    data: page.map((m) => formatMessage(channel, m, users)),
    has_more: hasMore,
    next_before: hasMore && page.length ? page[0].id : null,
  };
};

// ─── Read state ──────────────────────────────────────────────────────────────

const setReadPoint = async (conversationId, userId, messageId) => {
  await sequelize.query(
    `INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, last_read_at, created_at, updated_at)
     VALUES (:conversationId, :userId, :messageId, NOW(), NOW(), NOW())
     ON DUPLICATE KEY UPDATE last_read_message_id = VALUES(last_read_message_id), last_read_at = NOW(), updated_at = NOW()`,
    { replacements: { conversationId, userId, messageId } }
  );
};

const markRead = async (conv, userId, lastReadMessageId) => {
  const channel = await channelOf(conv);
  const messageId = lastReadMessageId
    || (await db[CHANNELS[channel].model].max('id', { where: { conversation_id: conv.id } }))
    || 0;
  await setReadPoint(conv.id, userId, messageId);
  const item = await getOne(conv, userId);
  realtime.emitToBusiness(conv.business_id, 'conversation:read', { id: conv.id, user_id: userId, unread_count: item.unread_count });
  emitCounts(conv.business_id, userId);
  return item;
};

const markUnread = async (conv, userId) => {
  // Step the read point back to just before the newest inbound message.
  await setReadPoint(conv.id, userId, Math.max((conv.last_inbound_message_id || 1) - 1, 0));
  const item = await getOne(conv, userId);
  realtime.emitToBusiness(conv.business_id, 'conversation:read', { id: conv.id, user_id: userId, unread_count: item.unread_count });
  emitCounts(conv.business_id, userId);
  return item;
};

const readAll = async ({ businessId, userId, channel }) => {
  const { byName } = await platforms();
  const platformIds = parseChannels(channel).map((c) => byName[c]).filter(Boolean);
  const [result] = await sequelize.query(
    `INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, last_read_at, created_at, updated_at)
     SELECT c.id, :userId, c.last_inbound_message_id, NOW(), NOW(), NOW() FROM conversations c
     WHERE c.business_id = :businessId AND c.last_inbound_message_id IS NOT NULL AND c.social_platform_id IN (:platformIds)
     ON DUPLICATE KEY UPDATE
       last_read_message_id = GREATEST(conversation_reads.last_read_message_id, VALUES(last_read_message_id)),
       last_read_at = NOW(), updated_at = NOW()`,
    { replacements: { userId, businessId, platformIds: platformIds.length ? platformIds : [0] } }
  );
  emitCounts(businessId, userId);
  return { updated: result?.affectedRows ?? 0 };
};

// ─── Assignment / status / tags ──────────────────────────────────────────────

/** Owner or active member of the business. */
const isMember = async (businessId, userId) => {
  const business = await Business.findByPk(businessId, { attributes: ['created_by'] });
  if (business?.created_by === userId) return true;
  return Boolean(await BusinessUser.findOne({ where: { business_id: businessId, user_id: userId, is_active: true }, attributes: ['id'] }));
};

const updateConversation = async (conv, userId, changes) => {
  const activities = [];
  const set = {};

  if (changes.assigned_to !== undefined && changes.assigned_to !== conv.assigned_to) {
    if (changes.assigned_to !== null && !(await isMember(conv.business_id, changes.assigned_to))) {
      throw httpError(400, 'assigned_to must be a member of this business');
    }
    set.assigned_to = changes.assigned_to;
    activities.push({ action: 'assigned', from_value: conv.assigned_to, to_value: changes.assigned_to });
  }

  let status = changes.status;
  if (status === undefined && changes.snoozed_until) status = 'snoozed';
  if (status !== undefined) {
    if (status === 'snoozed') {
      const until = changes.snoozed_until ? new Date(changes.snoozed_until) : null;
      if (!until || until <= new Date()) throw httpError(400, 'snoozed_until must be a future date when snoozing');
      set.snoozed_until = until;
    } else {
      set.snoozed_until = null;
    }
    if (status !== conv.status) activities.push({ action: 'status', from_value: conv.status, to_value: status });
    set.status = status;
  }

  let tagChange = null;
  if (changes.tags !== undefined) {
    const wanted = [...new Set(changes.tags.map(Number))];
    if (wanted.length) {
      const found = await Tag.count({ where: { id: wanted, business_id: conv.business_id } });
      if (found !== wanted.length) throw httpError(400, 'Every tag must belong to this business');
    }
    const current = (await ConversationTag.findAll({ where: { conversation_id: conv.id }, attributes: ['tag_id'] })).map((t) => t.tag_id);
    const sameSet = current.length === wanted.length && current.every((t) => wanted.includes(t));
    if (!sameSet) {
      tagChange = { current, wanted };
      activities.push({ action: 'tags', from_value: current, to_value: wanted });
    }
  }

  await sequelize.transaction(async (transaction) => {
    if (Object.keys(set).length) await conv.update(set, { transaction });
    if (tagChange) {
      await ConversationTag.destroy({ where: { conversation_id: conv.id }, transaction });
      if (tagChange.wanted.length) {
        await ConversationTag.bulkCreate(tagChange.wanted.map((tag_id) => ({ conversation_id: conv.id, tag_id })), { transaction });
      }
    }
    if (activities.length) {
      await ConversationActivity.bulkCreate(activities.map((a) => ({ ...a, conversation_id: conv.id, user_id: userId })), { transaction });
    }
  });

  const item = await getOne(conv, userId);
  if (activities.length) {
    realtime.emitToBusiness(conv.business_id, 'conversation:updated', {
      id: conv.id, status: item.status, assigned_to: item.assigned_to, tags: item.tags, snoozed_until: item.snoozed_until,
    });
  }
  return item;
};

// ─── Notes & activity ────────────────────────────────────────────────────────

const listNotes = async (conv) => ConversationNote.findAll({
  where: { conversation_id: conv.id },
  include: [{ model: User, as: 'author', attributes: ['id', 'name', 'avatar'] }],
  order: [['id', 'ASC']],
});

const addNote = async (conv, userId, { text, mentions = [] }) => {
  const unique = [...new Set(mentions.map(Number))];
  for (const id of unique) {
    if (!(await isMember(conv.business_id, id))) throw httpError(400, `Mentioned user ${id} is not a member of this business`);
  }
  const note = await ConversationNote.create({ conversation_id: conv.id, user_id: userId, text, mentions: unique });
  const full = await ConversationNote.findByPk(note.id, { include: [{ model: User, as: 'author', attributes: ['id', 'name', 'avatar'] }] });
  realtime.emitToBusiness(conv.business_id, 'conversation:note', { conversation_id: conv.id, note: full, mentions: unique });
  return full;
};

const listActivity = async (conv) => ConversationActivity.findAll({
  where: { conversation_id: conv.id },
  include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  order: [['id', 'DESC']],
  limit: 200,
});

// ─── Bulk ────────────────────────────────────────────────────────────────────

const bulk = async ({ businessId, userId, ids, action, value }) => {
  const convs = await Conversation.findAll({ where: { id: ids, business_id: businessId } });
  const found = new Set(convs.map((c) => c.id));
  const results = { updated: [], failed: [], not_found: ids.filter((id) => !found.has(id)) };

  for (const conv of convs) {
    try {
      if (action === 'assign') await updateConversation(conv, userId, { assigned_to: value ?? null });
      else if (action === 'resolve') await updateConversation(conv, userId, { status: 'resolved' });
      else if (action === 'reopen') await updateConversation(conv, userId, { status: 'open' });
      else if (action === 'read') await markRead(conv, userId);
      else if (action === 'unread') await markUnread(conv, userId);
      else if (action === 'tag') {
        const current = (await ConversationTag.findAll({ where: { conversation_id: conv.id }, attributes: ['tag_id'] })).map((t) => t.tag_id);
        await updateConversation(conv, userId, { tags: [...current, ...value] });
      }
      results.updated.push(conv.id);
    } catch (err) {
      results.failed.push({ id: conv.id, message: err.message });
    }
  }
  return results;
};

// ─── Jobs ────────────────────────────────────────────────────────────────────

/** Reopen snoozed conversations whose snoozed_until has passed. */
const wakeSnoozed = async () => {
  const due = await Conversation.findAll({
    where: { status: 'snoozed', snoozed_until: { [Op.lte]: new Date() } },
    attributes: ['id', 'business_id', 'assigned_to'],
    limit: 500,
  });
  if (!due.length) return 0;
  await Conversation.update({ status: 'open', snoozed_until: null }, { where: { id: due.map((c) => c.id), status: 'snoozed' } });
  due.forEach((c) => realtime.emitToBusiness(c.business_id, 'conversation:updated', { id: c.id, status: 'open', assigned_to: c.assigned_to }));
  return due.length;
};

module.exports = {
  CHANNELS,
  platforms,
  parseChannels,
  formatMessage,
  listConversations,
  counts,
  getConversation,
  getOne,
  listMessages,
  markRead,
  markUnread,
  readAll,
  updateConversation,
  listNotes,
  addNote,
  listActivity,
  bulk,
  wakeSnoozed,
  isMember,
  httpError,
  utc,
  // exported for tests
  _internals: { keysetCondition, encodeCursor, decodeCursor, messageText, mediaUrl, SORTS },
};
