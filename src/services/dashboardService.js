'use strict';

const { QueryTypes } = require('sequelize');
const {
  sequelize, Subscription, Plan, PlanFeature, BusinessUser, User, WhatsappDetail,
} = require('../../models');
const inbox = require('./inboxService');
const pipeline = require('./pipelineService');
const tickets = require('./ticketService');
const { resolveAccount } = require('../helpers/accountHelper');

const DAY = 24 * 3600 * 1000;
const httpError = inbox.httpError;

// shortcut: in-process cache, so each server instance caches separately; move to Redis when running several instances.
const cache = new Map();
const cached = async (key, fn) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return value;
};

/**
 * from/to as YYYY-MM-DD (UTC, both inclusive) or ISO datetimes.
 * Default: the last 30 days including today. Returns [start, endExclusive).
 */
const parseRange = ({ from, to }) => {
  const dateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const end = to ? new Date(dateOnly(to) ? new Date(to).getTime() + DAY : to) : new Date(today.getTime() + DAY);
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * DAY);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw httpError(400, 'from/to must be dates (YYYY-MM-DD)');
  if (start >= end) throw httpError(400, 'from must be before to');
  if (end - start > 366 * DAY) throw httpError(400, 'Range can be at most 366 days');
  return { start, end, prevStart: new Date(start.getTime() - (end - start)), prevEnd: start };
};

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const channelTables = async (channel) => {
  const { byName } = await inbox.platforms();
  return inbox.parseChannels(channel).map((name) => ({ name, table: inbox.CHANNELS[name].table, pid: byName[name] }));
};

const q = (sql, replacements) => sequelize.query(sql, {
  replacements: Object.fromEntries(Object.entries(replacements).map(([k, v]) => [k, v instanceof Date ? inbox.utc(v) : v])),
  type: QueryTypes.SELECT,
});

// ─── KPIs ────────────────────────────────────────────────────────────────────

const newLeads = async (businessId, tables, start, end) => {
  const rows = await q(
    `SELECT social_platform_id AS pid, COUNT(*) AS n FROM conversations
     WHERE business_id = :businessId AND social_platform_id IN (:pids) AND created_at >= :start AND created_at < :end
     GROUP BY social_platform_id`,
    { businessId, pids: tables.map((t) => t.pid), start, end }
  );
  const byChannel = Object.fromEntries(tables.map((t) => [t.name, 0]));
  rows.forEach((r) => { const t = tables.find((x) => x.pid === r.pid); if (t) byChannel[t.name] = Number(r.n); });
  return { value: Object.values(byChannel).reduce((a, b) => a + b, 0), by_channel: byChannel };
};

/** Median seconds from a conversation's first inbound message (in range) to the first reply after it. */
const firstResponse = async (businessId, tables, start, end) => {
  const seconds = [];
  for (const { table } of tables) {
    const rows = await q(
      `SELECT TIMESTAMPDIFF(SECOND, fi.first_in, (
                SELECT MIN(o.created_at) FROM ${table} o
                WHERE o.conversation_id = fi.conversation_id AND o.direction = 'outbound'
                  AND o.deleted_at IS NULL AND o.created_at >= fi.first_in)) AS secs
       FROM (SELECT m.conversation_id, MIN(m.created_at) AS first_in
             FROM ${table} m JOIN conversations c ON c.id = m.conversation_id
             WHERE c.business_id = :businessId AND m.direction = 'inbound' AND m.deleted_at IS NULL
             GROUP BY m.conversation_id
             HAVING first_in >= :start AND first_in < :end) fi`,
      { businessId, start, end }
    );
    rows.forEach((r) => { if (r.secs !== null) seconds.push(Number(r.secs)); });
  }
  return median(seconds);
};

const channelSplit = async (businessId, tables, start, end) => {
  const out = [];
  for (const { name, table } of tables) {
    const [row] = await q(
      `SELECT COUNT(DISTINCT m.conversation_id) AS n FROM ${table} m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.business_id = :businessId AND m.deleted_at IS NULL AND m.created_at >= :start AND m.created_at < :end`,
      { businessId, start, end }
    );
    out.push({ channel: name, conversations: Number(row.n) });
  }
  return out;
};

const openConversations = async (businessId, userId, tables) => {
  const counts = await inbox.counts({ businessId, userId });
  const [row] = await q(
    `SELECT COUNT(*) AS n FROM conversations
     WHERE business_id = :businessId AND social_platform_id IN (:pids) AND status IN ('open', 'pending')
       AND last_inbound_at IS NOT NULL AND last_inbound_at >= last_message_at`,
    { businessId, pids: tables.map((t) => t.pid) }
  );
  return { unread: counts.unread, unassigned: counts.unassigned, awaiting_reply: Number(row.n) };
};

const recentCampaigns = async (businessId) => {
  const rows = await q(
    `SELECT cp.id, cp.name, cp.status, cp.recipients_count, cp.created_at,
            SUM(cr.status = 'sent') AS sent,
            SUM(wm.status IN ('delivered', 'read')) AS delivered,
            SUM(wm.status = 'read') AS \`read\`,
            SUM(cr.status = 'failed' OR wm.status = 'failed') AS failed
     FROM (SELECT * FROM campaigns WHERE business_id = :businessId ORDER BY created_at DESC, id DESC LIMIT 5) cp
     LEFT JOIN campaign_recipients cr ON cr.campaign_id = cp.id
     LEFT JOIN whatsapp_messages wm ON wm.id = cr.whatsapp_message_id
     GROUP BY cp.id, cp.name, cp.status, cp.recipients_count, cp.created_at
     ORDER BY cp.created_at DESC, cp.id DESC`,
    { businessId }
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, status: r.status, recipients: r.recipients_count, created_at: r.created_at,
    sent: Number(r.sent) || 0, delivered: Number(r.delivered) || 0, read: Number(r.read) || 0, failed: Number(r.failed) || 0,
  }));
};

const usage = async (businessId) => {
  const seatsUsed = await BusinessUser.count({ where: { business_id: businessId, is_active: true } });
  const sub = await Subscription.findOne({
    where: { business_id: businessId, status: 'active' },
    include: [{ model: Plan, as: 'plan', include: [{ model: PlanFeature, as: 'features' }] }],
    order: [['created_at', 'DESC']],
  });
  const feature = (name) => {
    const f = sub?.plan?.features?.find((x) => x.feature_name === name);
    return f && !Number.isNaN(Number(f.feature_value)) ? Number(f.feature_value) : null;
  };
  return {
    plan: sub?.plan ? { id: sub.plan.id, name: sub.plan.name, ends_at: sub.ends_at } : null,
    seats_used: seatsUsed,
    seats_total: feature('max_users'),
    ai_messages_used: null, // AI Agent is on hold
    ai_messages_total: feature('ai_messages_per_month'),
  };
};

const summary = async ({ businessId, userId, query }) => {
  const range = parseRange(query);
  const tables = await channelTables(query.channel);
  const key = `summary:${businessId}:${userId}:${range.start.toISOString()}:${range.end.toISOString()}:${query.channel || ''}`;

  return cached(key, async () => {
    const [leads, prevLeads, frt, prevFrt, deals, prevDeals] = await Promise.all([
      newLeads(businessId, tables, range.start, range.end),
      newLeads(businessId, tables, range.prevStart, range.prevEnd),
      firstResponse(businessId, tables, range.start, range.end),
      firstResponse(businessId, tables, range.prevStart, range.prevEnd),
      pipeline.summary(businessId, range.start, range.end),
      pipeline.summary(businessId, range.prevStart, range.prevEnd),
    ]);
    // Conversion = deals won in the period ÷ new leads in the period.
    const rate = (won, leadCount) => (leadCount ? Number((won / leadCount).toFixed(4)) : null);
    return {
      range: { from: range.start.toISOString(), to: range.end.toISOString() },
      kpis: {
        new_leads: { value: leads.value, previous: prevLeads.value, by_channel: leads.by_channel },
        median_first_response_seconds: { value: frt, previous: prevFrt },
        conversion_rate: {
          value: rate(deals.won_count, leads.value),
          previous: rate(prevDeals.won_count, prevLeads.value),
          won_deals: deals.won_count,
        },
        messaging_spend: { value: null, previous: null, currency: 'usd', note: 'Needs Meta conversation pricing analytics' },
      },
      channels: await channelSplit(businessId, tables, range.start, range.end),
      open_conversations: await openConversations(businessId, userId, tables),
      pipeline_funnel: await pipeline.funnel(businessId),
      recent_campaigns: await recentCampaigns(businessId),
      usage: await usage(businessId),
    };
  });
};

// ─── Message volume ──────────────────────────────────────────────────────────

const isoDay = (d) => d.toISOString().slice(0, 10);
const mondayOf = (day) => {
  const d = new Date(day);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return isoDay(d);
};

const messageVolume = async ({ businessId, query }) => {
  const { start, end } = parseRange(query);
  const interval = query.interval || 'day';
  if (!['day', 'week'].includes(interval)) throw httpError(400, 'interval must be day or week');
  const tables = await channelTables(query.channel);

  const days = {};
  for (let t = start.getTime(); t < end.getTime(); t += DAY) days[isoDay(new Date(t))] = { inbound: 0, outbound: 0 };

  for (const { table } of tables) {
    const rows = await q(
      `SELECT DATE_FORMAT(m.created_at, '%Y-%m-%d') AS d,
              SUM(m.direction = 'inbound') AS inbound, SUM(m.direction = 'outbound') AS outbound
       FROM ${table} m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.business_id = :businessId AND m.deleted_at IS NULL AND m.created_at >= :start AND m.created_at < :end
       GROUP BY d`,
      { businessId, start, end }
    );
    rows.forEach((r) => {
      if (!days[r.d]) return;
      days[r.d].inbound += Number(r.inbound) || 0;
      days[r.d].outbound += Number(r.outbound) || 0;
    });
  }

  if (interval === 'day') return Object.entries(days).map(([date, v]) => ({ date, ...v }));

  const weeks = {};
  Object.entries(days).forEach(([date, v]) => {
    const w = (weeks[mondayOf(date)] ||= { inbound: 0, outbound: 0 });
    w.inbound += v.inbound;
    w.outbound += v.outbound;
  });
  return Object.entries(weeks).map(([date, v]) => ({ date, ...v }));
};

// ─── Team performance ────────────────────────────────────────────────────────

const teamPerformance = async ({ businessId, query }) => {
  const { start, end } = parseRange(query);
  const tables = await channelTables(query.channel);

  return cached(`team:${businessId}:${start.toISOString()}:${end.toISOString()}:${query.channel || ''}`, async () => {
    const members = await BusinessUser.findAll({
      where: { business_id: businessId, is_active: true },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar'] }],
    });
    const stats = new Map(members.filter((m) => m.user).map((m) => [m.user.id, {
      user_id: m.user.id, name: m.user.name, email: m.user.email, avatar: m.user.avatar,
      conversations: new Set(), replies: [],
    }]));

    for (const { table } of tables) {
      // A reply = an agent's outbound message whose previous message in the thread was inbound.
      const rows = await q(
        `SELECT x.sender_id, x.conversation_id, x.prev_dir, TIMESTAMPDIFF(SECOND, x.prev_at, x.created_at) AS secs
         FROM (
           SELECT m.sender_id, m.conversation_id, m.direction, m.created_at,
                  LAG(m.direction) OVER w AS prev_dir, LAG(m.created_at) OVER w AS prev_at
           FROM ${table} m JOIN conversations c ON c.id = m.conversation_id
           WHERE c.business_id = :businessId AND m.deleted_at IS NULL
             AND m.created_at >= :lookback AND m.created_at < :end
           WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.id)
         ) x
         WHERE x.direction = 'outbound' AND x.sender_id IS NOT NULL AND x.created_at >= :start`,
        { businessId, start, end, lookback: new Date(start.getTime() - 7 * DAY) }
      );
      rows.forEach((r) => {
        const s = stats.get(r.sender_id);
        if (!s) return;
        s.conversations.add(`${table}:${r.conversation_id}`);
        if (r.prev_dir === 'inbound' && r.secs !== null) s.replies.push(Number(r.secs));
      });
    }

    const resolved = await tickets.resolvedByAgent(businessId, start, end);
    return [...stats.values()]
      .map(({ conversations, replies, ...s }) => ({
        ...s,
        conversations: conversations.size,
        replies: replies.length,
        median_reply_seconds: median(replies),
        tickets_resolved: resolved[s.user_id] || 0,
      }))
      .sort((a, b) => b.conversations - a.conversations);
  });
};

// ─── WhatsApp number health ──────────────────────────────────────────────────

const TIER_LIMITS = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: null };

const numberHealth = async ({ businessId, query }) => {
  const detail = await resolveAccount(WhatsappDetail, businessId, query.account_id ? Number(query.account_id) : null, 'WhatsApp');

  let refreshed = false;
  let refreshError = null;
  if (query.refresh === 'true') {
    try {
      await require('./whatsappService').getAccountHealth(businessId, detail.id);
      await detail.reload();
      refreshed = true;
    } catch (err) {
      refreshError = err.message;
    }
  }

  // Business-initiated (template) conversations opened in the last 24h — what Meta's tier limits.
  const [row] = await q(
    `SELECT COUNT(DISTINCT m.conversation_id) AS n FROM whatsapp_messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.business_id = :businessId AND c.account_id = :accountId AND m.direction = 'outbound'
       AND m.message_type = 'template' AND m.status <> 'failed' AND m.deleted_at IS NULL
       AND m.created_at >= :since`,
    { businessId, accountId: detail.id, since: new Date(Date.now() - DAY) }
  );

  const tier = detail.messaging_limit_tier || null;
  return {
    account_id: detail.id,
    display_phone_number: detail.display_phone_number,
    status: detail.account_status || null,
    quality_rating: detail.quality_rating || null,
    messaging_limit_tier: tier,
    limit_used_24h: Number(row.n),
    limit_total: tier && tier in TIER_LIMITS ? TIER_LIMITS[tier] : null,
    is_active: detail.is_active,
    refreshed,
    ...(refreshError && { refresh_error: refreshError }),
    updated_at: detail.updated_at,
  };
};

module.exports = {
  summary,
  messageVolume,
  teamPerformance,
  numberHealth,
  _internals: { parseRange, median, mondayOf },
};
