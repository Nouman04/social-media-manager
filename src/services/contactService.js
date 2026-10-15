'use strict';

const { Op } = require('sequelize');
const {
  Contact, Conversation, SocialPlatform, WhatsappDetail, InstagramDetail, MessengerDetail,
} = require('../../models');

// Same rule the WhatsApp send path enforces: digits only, with country code.
const PHONE_RE = /^\d{7,15}$/;
const CONSENT = ['opted_in', 'opted_out', 'unknown'];
const MAX_IMPORT_ROWS = 1000;

const badRequest = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

/**
 * Turn whatever a spreadsheet holds into the digits-only international form
 * WhatsApp expects: "+92 300-1234567", "0092300…" and, given a default
 * country code, the local "03001234567" all become "923001234567".
 *
 * Excel stores a typed-in 03001234567 as the number 3001234567, so a short
 * number (≤ 10 digits) without the default code gets it prepended too.
 * ponytail: length heuristic — a foreign number typed without its "+" and
 * ≤ 10 digits long would wrongly get the default code; use libphonenumber if
 * imports span many countries.
 *
 * @returns {string|null} null when it can't be a phone number.
 */
const normalizePhone = (raw, defaultCountryCode = '') => {
  const cc = String(defaultCountryCode || '').replace(/\D/g, '');
  const hadPlus = String(raw ?? '').trim().startsWith('+');
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (cc && !hadPlus && digits.startsWith('0')) digits = cc + digits.slice(1);
  else if (cc && !hadPlus && digits.length <= 10 && !digits.startsWith(cc)) digits = cc + digits;
  // No country code starts with 0, so a leftover leading 0 means "local, code unknown".
  return PHONE_RE.test(digits) && !digits.startsWith('0') ? digits : null;
};

/** "vip, lahore" or ["vip","lahore"] -> ['vip', 'lahore'] */
const parseTags = (raw) => {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;|]/);
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
};

/** A sheet's opt-in cell -> consent, or null when the cell says nothing. */
const parseConsent = (raw) => {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (['yes', 'y', 'true', '1', 'opted_in', 'opt-in', 'optin', 'subscribed'].includes(v)) return 'opted_in';
  if (['no', 'n', 'false', '0', 'opted_out', 'opt-out', 'optout', 'stop', 'unsubscribed'].includes(v)) return 'opted_out';
  return null;
};

/** WHERE fragment: the contact carries at least one of these tags. */
const hasAnyTag = (tags) => {
  const { sequelize } = Contact;
  return {
    [Op.or]: parseTags(tags).map((t) =>
      sequelize.where(sequelize.fn('JSON_CONTAINS', sequelize.col('tags'), JSON.stringify(t)), 1)),
  };
};

const contactService = {

  normalizePhone,
  parseConsent,
  hasAnyTag,

  /**
   * Upsert spreadsheet rows as contacts, keyed by (business, phone).
   *
   * Consent: a row's own opt_in cell wins. Otherwise consentConfirmed (the
   * uploader confirming everyone in the file agreed to WhatsApp messages)
   * marks it opted_in — but never re-subscribes someone who opted out.
   *
   * @param {number} businessId
   * @param {Array<{name?, phone, email?, tags?, opt_in?}>} rows
   * @param {object} opts { consentConfirmed, defaultCountryCode, userId }
   * @returns {Promise<{created, updated, failed: Array<{row, phone, error}>}>}
   */
  importContacts: async (businessId, rows, { consentConfirmed = false, defaultCountryCode = '', userId = null } = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest('rows must be a non-empty array.');
    if (rows.length > MAX_IMPORT_ROWS) {
      throw badRequest(`At most ${MAX_IMPORT_ROWS} rows per request — send the file in chunks.`);
    }

    const failed = [];
    const byPhone = new Map(); // later rows for the same number win, tags accumulate

    rows.forEach((row, i) => {
      const phone = normalizePhone(row?.phone, defaultCountryCode);
      if (!phone) {
        failed.push({ row: i + 1, phone: row?.phone ?? null, error: 'Invalid or missing phone number' });
        return;
      }
      const prev = byPhone.get(phone);
      byPhone.set(phone, {
        name: String(row.name ?? '').trim() || prev?.name || null,
        email: String(row.email ?? '').trim() || prev?.email || null,
        tags: parseTags([...(prev?.tags || []), ...parseTags(row.tags)]),
        consent: parseConsent(row.opt_in) ?? prev?.consent ?? null,
      });
    });

    const phones = [...byPhone.keys()];
    const existing = phones.length
      ? await Contact.findAll({ where: { business_id: businessId, phone: phones } })
      : [];
    const existingByPhone = new Map(existing.map((c) => [c.phone, c]));

    const now = new Date();
    let created = 0;
    let updated = 0;
    const toCreate = [];

    for (const [phone, data] of byPhone) {
      const current = existingByPhone.get(phone);
      let consent = data.consent;
      if (!consent && consentConfirmed && current?.whatsapp_consent !== 'opted_out') consent = 'opted_in';

      if (current) {
        const changes = {
          name: data.name || current.name,
          email: data.email || current.email,
          tags: parseTags([...(current.tags || []), ...data.tags]),
        };
        if (consent && consent !== current.whatsapp_consent) {
          Object.assign(changes, { whatsapp_consent: consent, consent_source: 'import', consent_at: now });
        }
        await current.update(changes);
        updated++;
      } else {
        toCreate.push({
          business_id: businessId,
          phone,
          name: data.name,
          email: data.email,
          tags: data.tags,
          whatsapp_consent: consent || 'unknown',
          consent_source: consent ? 'import' : null,
          consent_at: consent ? now : null,
          created_by: userId,
        });
      }
    }

    if (toCreate.length) {
      await Contact.bulkCreate(toCreate);
      created = toCreate.length;
    }

    return { created, updated, failed };
  },

  /**
   * Add one contact by hand. Consent must be stated explicitly.
   */
  createContact: async (businessId, { name, phone, email, tags, whatsapp_consent = 'unknown', default_country_code = '' }, userId) => {
    const normalized = normalizePhone(phone, default_country_code);
    if (!normalized) throw badRequest(`Invalid phone number "${phone}". Use digits with country code, e.g. 923001234567.`);
    if (!CONSENT.includes(whatsapp_consent)) throw badRequest(`whatsapp_consent must be one of: ${CONSENT.join(', ')}`);

    try {
      return await Contact.create({
        business_id: businessId,
        name: name || null,
        phone: normalized,
        email: email || null,
        tags: parseTags(tags),
        whatsapp_consent,
        consent_source: whatsapp_consent === 'unknown' ? null : 'manual',
        consent_at: whatsapp_consent === 'unknown' ? null : new Date(),
        created_by: userId,
      });
    } catch (dbErr) {
      if (dbErr?.name === 'SequelizeUniqueConstraintError') {
        const err = new Error(`A contact with phone ${normalized} already exists.`);
        err.statusCode = 409;
        throw err;
      }
      throw dbErr;
    }
  },

  /**
   * List contacts. Filters: search (name/phone/email), tag, consent, whatsappStatus.
   */
  listContacts: async (businessId, { search, tag, consent, whatsappStatus, limit = 50, offset = 0 } = {}) => {
    const where = { business_id: businessId };
    if (search) {
      const like = `%${search}%`;
      where[Op.or] = [{ name: { [Op.like]: like } }, { phone: { [Op.like]: like } }, { email: { [Op.like]: like } }];
    }
    if (consent) where.whatsapp_consent = consent;
    if (whatsappStatus) where.whatsapp_status = whatsappStatus;
    if (tag) where[Op.and] = [hasAnyTag([tag])];

    const { rows, count } = await Contact.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(Number(limit) || 50, 500),
      offset: Number(offset) || 0,
    });
    return { total: count, limit: Number(limit), offset: Number(offset), contacts: rows };
  },

  /**
   * Make sure someone the business chats with on WhatsApp is in its contact
   * book, and record what the latest message proved about their number.
   *
   * Called from the WhatsApp inbox paths (send, inbound, status webhook). It
   * never touches consent — chatting is not marketing opt-in — and it never
   * throws: messaging must not fail because the contact book did.
   *
   * @param {number} businessId
   * @param {string} phone - Digits only, as WhatsApp reports it.
   * @param {object} [opts] { name, status: 'valid' | 'invalid' }
   */
  recordWhatsappContact: async (businessId, phone, { name = null, status = null } = {}) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!businessId || !PHONE_RE.test(digits)) return;

    try {
      const [contact, created] = await Contact.findOrCreate({
        where: { business_id: businessId, phone: digits },
        defaults: { business_id: businessId, phone: digits, name, tags: [] },
      });

      const changes = {};
      if (!created && name && !contact.name) changes.name = name;
      if (status && status !== contact.whatsapp_status) {
        changes.whatsapp_status = status;
        changes.whatsapp_checked_at = new Date();
      }
      if (Object.keys(changes).length) await contact.update(changes);
    } catch (err) {
      // A concurrent webhook may have created the same contact first — fine.
      if (err?.name !== 'SequelizeUniqueConstraintError') {
        console.warn(`[contactService.recordWhatsappContact] business=${businessId} phone=${digits}:`, err.message);
      }
    }
  },

  /**
   * Edit name, email, tags or WhatsApp consent of one contact.
   */
  updateContact: async (businessId, contactId, { name, email, tags, whatsapp_consent }) => {
    const contact = await Contact.findOne({ where: { id: contactId, business_id: businessId } });
    if (!contact) {
      const err = new Error(`Contact ${contactId} not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    const changes = {};
    if (name !== undefined) changes.name = name || null;
    if (email !== undefined) changes.email = email || null;
    if (tags !== undefined) changes.tags = parseTags(tags);
    if (whatsapp_consent !== undefined) {
      if (!CONSENT.includes(whatsapp_consent)) throw badRequest(`whatsapp_consent must be one of: ${CONSENT.join(', ')}`);
      if (whatsapp_consent !== contact.whatsapp_consent) {
        Object.assign(changes, { whatsapp_consent, consent_source: 'manual', consent_at: new Date() });
      }
    }

    if (!Object.keys(changes).length) throw badRequest('Nothing to update (name, email, tags, whatsapp_consent).');
    return contact.update(changes);
  },

  deleteContact: async (businessId, contactId) => {
    const deleted = await Contact.destroy({ where: { id: contactId, business_id: businessId } });
    if (!deleted) {
      const err = new Error(`Contact ${contactId} not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }
    return { id: Number(contactId), deleted: true };
  },

  /**
   * Everyone who has a conversation with any of the business's WhatsApp,
   * Instagram or Messenger accounts, in one list — newest activity first.
   * Each row says which platform and which connected account it came through.
   *
   * @param {object} opts { platform?, accountId?, search?, limit?, offset? }
   */
  listChannelUsers: async (businessId, { platform, accountId, search, limit = 50, offset = 0 } = {}) => {
    const where = { business_id: businessId };
    if (accountId) where.account_id = accountId;
    if (search) {
      const like = `%${search}%`;
      where[Op.or] = [{ contact_name: { [Op.like]: like } }, { contact_identifier: { [Op.like]: like } }];
    }

    const platformWhere = { name: platform ? [platform] : ['whatsapp', 'instagram', 'messenger'] };

    const { rows, count } = await Conversation.findAndCountAll({
      where,
      include: [{ model: SocialPlatform, as: 'socialPlatform', attributes: ['name', 'label'], where: platformWhere }],
      order: [['updated_at', 'DESC']],
      limit: Math.min(Number(limit) || 50, 500),
      offset: Number(offset) || 0,
    });

    // account_id points at a different table per platform — label them in one
    // query per platform rather than one per row.
    const LABELS = {
      whatsapp: [WhatsappDetail, (d) => d.display_phone_number || d.phone_number_id],
      instagram: [InstagramDetail, (d) => (d.username ? `@${d.username}` : d.ig_user_id)],
      messenger: [MessengerDetail, (d) => d.page_name || d.page_id],
    };
    const labels = {};
    for (const [name, [Model, label]] of Object.entries(LABELS)) {
      const ids = rows.filter((c) => c.socialPlatform?.name === name && c.account_id).map((c) => c.account_id);
      if (!ids.length) continue;
      const details = await Model.findAll({ where: { id: [...new Set(ids)] }, paranoid: false });
      details.forEach((d) => { labels[`${name}:${d.id}`] = label(d); });
    }

    return {
      total: count,
      limit: Number(limit),
      offset: Number(offset),
      users: rows.map((c) => ({
        conversation_id: c.id,
        platform: c.socialPlatform?.name,
        account_id: c.account_id,
        account_label: labels[`${c.socialPlatform?.name}:${c.account_id}`] || null,
        contact_identifier: c.contact_identifier,
        contact_name: c.contact_name,
        last_activity_at: c.updated_at,
        first_seen_at: c.created_at,
      })),
    };
  },
};

module.exports = contactService;
