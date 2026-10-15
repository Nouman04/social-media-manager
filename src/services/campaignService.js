'use strict';

const { Op } = require('sequelize');
const {
  Campaign, CampaignRecipient, Contact, WhatsappDetail, WhatsappTemplate, WhatsappMessage, sequelize,
} = require('../../models');
const { resolveAccount } = require('../helpers/accountHelper');
const { hasAnyTag } = require('./contactService');
const whatsappService = require('./whatsappService');
const realtime = require('../helpers/realtime');
const { enqueueRecipients } = require('../queues/campaignQueue');

// Gap between free-text sends (sendTextToContacts). Campaign sends are paced
// by the queue's limiter instead.
const SEND_INTERVAL_MS = 150;

// Meta throttling codes — worth retrying after a backoff, unlike a rejected
// template or number: 4 app rate limit, 80007 WABA rate limit, 130429
// throughput reached, 131048 spam rate limit, 131056 pair rate limit.
const RETRYABLE_META_CODES = [4, 80007, 130429, 131048, 131056];
const isRetryable = (err) =>
  (err.statusCode || 500) >= 500 || RETRYABLE_META_CODES.includes(err.metaError?.code);

const fail = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const percentOf = (done, total) => (total ? Math.floor((done / total) * 100) : 0);
const emptyProgress = () => ({ total: 0, queued: 0, sent: 0, failed: 0, processed: 0, percent: 0 });

/**
 * Send progress per campaign from the recipients' own status: processed =
 * sent + failed, percent = processed / total (floored, so 100 means done).
 */
const progressFor = async (campaignIds) => {
  if (!campaignIds.length) return {};
  const rows = await sequelize.query(`
    SELECT campaign_id, status, COUNT(*) AS n
    FROM campaign_recipients
    WHERE campaign_id IN (:ids)
    GROUP BY campaign_id, status
  `, { replacements: { ids: campaignIds }, type: sequelize.QueryTypes.SELECT });

  const out = {};
  rows.forEach(({ campaign_id, status, n }) => {
    const p = out[campaign_id] || (out[campaign_id] = emptyProgress());
    p[status] += Number(n);
    p.total += Number(n);
  });
  Object.values(out).forEach((p) => {
    p.processed = p.sent + p.failed;
    p.percent = percentOf(p.processed, p.total);
  });
  return out;
};

/**
 * Fill "{{contact.name}}", "{{contact.phone}}", "{{contact.email}}" in one
 * variable. "{{contact.name|Customer}}" falls back when the field is empty —
 * Meta rejects a template whose parameter is blank.
 */
const renderVariable = (template, contact) =>
  String(template ?? '').replace(/\{\{\s*contact\.(\w+)\s*(?:\|([^}]*))?\}\}/g, (_, field, fallback) => {
    const value = contact?.[field];
    return value !== null && value !== undefined && String(value).trim() !== '' ? String(value) : (fallback ?? '').trim();
  });

/** Body parameters for one contact, in the template's {{1}}, {{2}}… order. */
const buildComponents = (variables, contact) => {
  if (!Array.isArray(variables) || variables.length === 0) return [];
  return [{
    type: 'body',
    parameters: variables.map((v) => ({ type: 'text', text: renderVariable(v, contact) || '-' })),
  }];
};

/**
 * Opted-in contacts matching a campaign audience. Numbers already known not
 * to be on WhatsApp are left out — every template send is billed.
 */
const audienceWhere = (businessId, audience = {}) => {
  const where = {
    business_id: businessId,
    whatsapp_consent: 'opted_in',
    whatsapp_status: { [Op.ne]: 'invalid' },
  };
  const and = [];
  if (Array.isArray(audience.contact_ids) && audience.contact_ids.length) and.push({ id: audience.contact_ids });
  if (Array.isArray(audience.tags) && audience.tags.length) and.push(hasAnyTag(audience.tags));
  if (and.length) where[Op.and] = and;
  return where;
};

const loadCampaign = async (businessId, campaignId) => {
  const campaign = await Campaign.findOne({ where: { id: campaignId, business_id: businessId } });
  if (!campaign) throw fail(404, `Campaign ${campaignId} not found for business_id=${businessId}`);
  return campaign;
};

const campaignService = {

  renderVariable,

  /**
   * Opted-in contacts an audience would reach — for a count before sending.
   */
  previewAudience: async (businessId, audience = {}) => {
    const count = await Contact.count({ where: audienceWhere(businessId, audience) });
    const sample = await Contact.findAll({
      where: audienceWhere(businessId, audience),
      attributes: ['id', 'name', 'phone', 'tags'],
      limit: 5,
    });
    return { count, sample };
  },

  /**
   * Save a draft campaign. The template must be APPROVED in the sending
   * number's WABA (sync with GET /api/v1/whatsapp/templates first).
   */
  createCampaign: async (businessId, userId, { name, account_id, template_name, language, variables = [], audience = {} }) => {
    if (!name || !template_name) throw fail(400, 'name and template_name are required.');
    if (!Array.isArray(variables)) throw fail(400, 'variables must be an array of strings.');

    const account = await resolveAccount(WhatsappDetail, businessId, account_id, 'WhatsApp');

    // language is optional — the template's own language is used when omitted.
    const templateWhere = { business_id: businessId, waba_id: account.waba_id, name: template_name };
    if (language) templateWhere.language = language;
    const template = await WhatsappTemplate.findOne({ where: templateWhere });
    if (!template) {
      throw fail(400, `Template "${template_name}"${language ? ` (${language})` : ''} is not in this number's WABA — sync templates and check the name/language.`);
    }
    if (template.status !== 'APPROVED') {
      throw fail(400, `Template "${template_name}" is ${template.status}; only APPROVED templates can be sent.`);
    }

    const campaign = await Campaign.create({
      business_id: businessId,
      name,
      account_id: account.id,
      template_name,
      language: template.language,
      variables,
      audience,
      status: 'draft',
      created_by: userId,
    });

    const { count } = await campaignService.previewAudience(businessId, audience);
    return { campaign, estimated_recipients: count, template_category: template.category };
  },

  /**
   * Campaigns newest first, each with its send progress (percent processed).
   */
  listCampaigns: async (businessId, { limit = 50, offset = 0 } = {}) => {
    const { rows, count } = await Campaign.findAndCountAll({
      where: { business_id: businessId },
      order: [['created_at', 'DESC']],
      limit: Math.min(Number(limit) || 50, 200),
      offset: Number(offset) || 0,
    });

    const progress = await progressFor(rows.map((c) => c.id));
    return {
      total: count,
      campaigns: rows.map((c) => ({ ...c.toJSON(), progress: progress[c.id] || emptyProgress() })),
    };
  },

  /**
   * Freeze the audience into campaign_recipients and queue one job per
   * recipient. Re-calling it re-queues recipients still 'queued' (if Redis
   * was wiped, or a campaign stopped part-way); jobIds keep that idempotent.
   */
  sendCampaign: async (businessId, campaignId) => {
    const campaign = await loadCampaign(businessId, campaignId);
    if (campaign.status === 'sending') throw fail(409, 'This campaign is already sending.');

    if (campaign.status === 'draft') {
      const contacts = await Contact.findAll({
        where: audienceWhere(businessId, campaign.audience || {}),
        attributes: ['id', 'phone'],
      });
      if (!contacts.length) throw fail(400, 'No opted-in contacts match this audience.');

      await CampaignRecipient.bulkCreate(
        contacts.map((c) => ({ campaign_id: campaign.id, contact_id: c.id, phone: c.phone })),
        { ignoreDuplicates: true }
      );
      await campaign.update({ recipients_count: contacts.length });
    }

    const queued = await CampaignRecipient.findAll({
      where: { campaign_id: campaign.id, status: 'queued' },
      attributes: ['id'],
      order: [['id', 'ASC']],
    });
    if (!queued.length) throw fail(400, `Nothing left to send — campaign is ${campaign.status}.`);

    // 'sending' before the jobs exist: a fast worker could otherwise finish
    // every job while the campaign still says draft, and never complete it.
    const previous = campaign.status;
    await campaign.update({ status: 'sending', started_at: campaign.started_at || new Date(), completed_at: null });
    try {
      await enqueueRecipients(campaign.id, queued.map((r) => r.id));
    } catch (err) {
      await campaign.update({ status: previous });
      throw err;
    }

    await campaignService.reportProgress(campaign.id);
    return { campaign_id: campaign.id, status: 'sending', queued: queued.length };
  },

  /**
   * BullMQ processor — send one recipient's template.
   *
   * Consent is re-checked here so an opt-out that arrives mid-campaign is
   * honoured. Meta 5xx / rate-limit errors are thrown so BullMQ retries with
   * backoff; anything else (or the last attempt) marks the recipient failed.
   */
  processRecipient: async (job) => {
    const { campaignId, recipientId } = job.data;
    const recipient = await CampaignRecipient.findByPk(recipientId, {
      include: [{ model: Contact, as: 'contact' }, { model: Campaign, as: 'campaign' }],
    });
    // Already handled (a re-queued duplicate) or deleted with its campaign.
    if (!recipient || recipient.status !== 'queued' || !recipient.campaign) return 'skipped';

    const { campaign, contact } = recipient;
    try {
      if (!contact || contact.whatsapp_consent !== 'opted_in') {
        await recipient.update({ status: 'failed', error_message: 'Contact is no longer opted in' });
        return 'skipped';
      }

      try {
        const { record } = await whatsappService.sendTemplateMessage(
          campaign.business_id,
          recipient.phone,
          campaign.template_name,
          campaign.language,
          buildComponents(campaign.variables, contact),
          campaign.created_by,
          null,
          campaign.account_id
        );
        await recipient.update({ status: 'sent', whatsapp_message_id: record.id, sent_at: new Date() });
        return 'sent';
      } catch (err) {
        const attemptsLeft = (job.opts.attempts || 1) - (job.attemptsMade + 1);
        if (isRetryable(err) && attemptsLeft > 0) throw err; // BullMQ retries with backoff

        await recipient.update({
          status: 'failed',
          whatsapp_message_id: err.record?.id || null,
          error_message: err.message,
        });
        return 'failed';
      }
    } finally {
      await campaignService.reportProgress(campaignId);
    }
  },

  /**
   * Push the campaign's progress to the inbox, and close it out once no
   * recipient is left queued.
   */
  reportProgress: async (campaignId) => {
    const campaign = await Campaign.findByPk(campaignId, { attributes: ['id', 'business_id', 'status'] });
    if (!campaign) return;
    const progress = (await progressFor([campaignId]))[campaignId] || emptyProgress();

    realtime.emitToBusiness(campaign.business_id, 'campaign:progress', { campaign_id: campaignId, ...progress });

    if (progress.total && progress.queued === 0) {
      // Concurrent jobs can all see "0 queued" — only the one that flips the
      // status announces completion.
      const [changed] = await Campaign.update(
        { status: 'completed', completed_at: new Date() },
        { where: { id: campaignId, status: 'sending' } }
      );
      if (changed) {
        realtime.emitToBusiness(campaign.business_id, 'campaign:completed', { campaign_id: campaignId, ...progress });
        console.log(`[campaignService] Campaign ${campaignId} completed | sent=${progress.sent} | failed=${progress.failed}`);
      }
    }
  },

  /**
   * Campaign plus its funnel: queued / sent / failed from our side, and
   * delivered / read from Meta's status webhooks on each message.
   */
  getCampaign: async (businessId, campaignId) => {
    const campaign = await loadCampaign(businessId, campaignId);

    const rows = await sequelize.query(`
      SELECT cr.status AS send_status, wm.status AS message_status, COUNT(*) AS n
      FROM campaign_recipients cr
      LEFT JOIN whatsapp_messages wm ON wm.id = cr.whatsapp_message_id
      WHERE cr.campaign_id = :id
      GROUP BY cr.status, wm.status
    `, { replacements: { id: campaign.id }, type: sequelize.QueryTypes.SELECT });

    const stats = { total: 0, queued: 0, sent: 0, failed: 0, delivered: 0, read: 0 };
    rows.forEach(({ send_status, message_status, n }) => {
      const count = Number(n);
      stats.total += count;
      if (send_status === 'queued') stats.queued += count;
      // A message Meta later reports as failed counts as failed, not sent.
      else if (send_status === 'failed' || message_status === 'failed') stats.failed += count;
      else {
        stats.sent += count;
        if (message_status === 'delivered' || message_status === 'read') stats.delivered += count;
        if (message_status === 'read') stats.read += count;
      }
    });
    stats.percent = percentOf(stats.total - stats.queued, stats.total);

    return { campaign, stats, is_running: campaign.status === 'sending' };
  },

  /**
   * Send one free-form text to a few chosen contacts, right now.
   *
   * WhatsApp only delivers free-form text inside the 24h window after the
   * contact last wrote to us — outside it Meta fails the message (131047) and
   * a template campaign is the way to reach them. Not a broadcast tool, so it
   * is capped and needs no consent; each result is reported back.
   */
  sendTextToContacts: async (businessId, userId, { contact_ids, body, account_id = null }) => {
    const MAX = 50;
    if (!body || !String(body).trim()) throw fail(400, 'body is required.');
    if (!Array.isArray(contact_ids) || contact_ids.length === 0) throw fail(400, 'contact_ids must be a non-empty array.');
    if (contact_ids.length > MAX) throw fail(400, `At most ${MAX} contacts per text send — use a template campaign for more.`);

    // Resolve the number once, so a bad account_id fails the request up front
    // instead of failing every contact the same way.
    const account = await resolveAccount(WhatsappDetail, businessId, account_id, 'WhatsApp');

    const contacts = await Contact.findAll({ where: { business_id: businessId, id: contact_ids } });
    const results = [];

    for (const contact of contacts) {
      try {
        const { record } = await whatsappService.sendTextMessage(
          businessId, contact.phone, String(body), false, userId, null, account.id
        );
        results.push({ contact_id: contact.id, phone: contact.phone, status: 'sent', message_id: record.id });
      } catch (err) {
        results.push({ contact_id: contact.id, phone: contact.phone, status: 'failed', error: err.message });
      }
      await sleep(SEND_INTERVAL_MS);
    }

    const missing = contact_ids.length - contacts.length;
    return {
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
      not_found: missing,
      results,
    };
  },

  /**
   * Per-recipient results, optionally filtered by our send status.
   */
  getRecipients: async (businessId, campaignId, { status, limit = 100, offset = 0 } = {}) => {
    const campaign = await loadCampaign(businessId, campaignId);
    const where = { campaign_id: campaign.id };
    if (status) where.status = status;

    const { rows, count } = await CampaignRecipient.findAndCountAll({
      where,
      include: [
        { model: Contact, as: 'contact', attributes: ['id', 'name', 'phone'] },
        { model: WhatsappMessage, as: 'message', attributes: ['id', 'wamid', 'status', 'error_code', 'error_message'] },
      ],
      order: [['id', 'ASC']],
      limit: Math.min(Number(limit) || 100, 500),
      offset: Number(offset) || 0,
    });
    return { total: count, recipients: rows };
  },
};

module.exports = campaignService;
