'use strict';

const contactService = require('../services/contactService');

/**
 * Shared error responder — forwards the service's statusCode.
 */
const fail = (res, err, context) => {
  console.error(`[contactController.${context}] Error:`, err.message);
  return res.status(err.statusCode || 500).json({ success: false, message: err.message });
};

// Every handler runs behind authorizeBusiness, which has already checked the
// caller belongs to the business and put its id on req.businessId.
module.exports = {

  /**
   * POST /api/v1/contacts/import
   * Body: { business_id, rows: [{ name?, phone, email?, tags?, opt_in? }],
   *         consent_confirmed?, default_country_code? }
   * At most 1000 rows per call — the contacts page sends a file in chunks.
   */
  importContacts: async (req, res) => {
    try {
      const { rows, consent_confirmed = false, default_country_code = '' } = req.body;
      const result = await contactService.importContacts(req.businessId, rows, {
        consentConfirmed: consent_confirmed === true || consent_confirmed === 'true',
        defaultCountryCode: String(default_country_code || '').replace(/\D/g, ''),
        userId: req.user.id,
      });
      return res.status(200).json({ success: true, message: 'Contacts imported', ...result });
    } catch (err) {
      return fail(res, err, 'importContacts');
    }
  },

  /**
   * POST /api/v1/contacts
   * Body: { business_id, name?, phone, email?, tags?, whatsapp_consent?, default_country_code? }
   */
  createContact: async (req, res) => {
    try {
      const contact = await contactService.createContact(req.businessId, req.body, req.user.id);
      return res.status(201).json({ success: true, message: 'Contact added', contact });
    } catch (err) {
      return fail(res, err, 'createContact');
    }
  },

  /**
   * GET /api/v1/contacts?business_id=&search=&tag=&consent=&whatsapp_status=&limit=&offset=
   * whatsapp_status: unknown | valid | invalid
   */
  listContacts: async (req, res) => {
    try {
      const { search, tag, consent, whatsapp_status, limit, offset } = req.query;
      const data = await contactService.listContacts(req.businessId, {
        search, tag, consent, whatsappStatus: whatsapp_status, limit, offset,
      });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'listContacts');
    }
  },

  /**
   * PATCH /api/v1/contacts/:id
   * Body: { business_id, name?, email?, tags?, whatsapp_consent? }
   */
  updateContact: async (req, res) => {
    try {
      const contact = await contactService.updateContact(req.businessId, req.params.id, req.body);
      return res.status(200).json({ success: true, message: 'Contact updated', contact });
    } catch (err) {
      return fail(res, err, 'updateContact');
    }
  },

  /**
   * DELETE /api/v1/contacts/:id?business_id=
   */
  deleteContact: async (req, res) => {
    try {
      const result = await contactService.deleteContact(req.businessId, req.params.id);
      return res.status(200).json({ success: true, message: 'Contact deleted', ...result });
    } catch (err) {
      return fail(res, err, 'deleteContact');
    }
  },

  /**
   * GET /api/v1/contacts/channel-users?business_id=&platform=&account_id=&search=&limit=&offset=
   * Everyone who messaged any connected WhatsApp / Instagram / Messenger
   * account, in one list. platform: whatsapp | instagram | messenger.
   */
  listChannelUsers: async (req, res) => {
    try {
      const { platform, account_id, search, limit, offset } = req.query;
      if (platform && !['whatsapp', 'instagram', 'messenger'].includes(platform)) {
        return res.status(400).json({ success: false, message: 'platform must be whatsapp, instagram or messenger' });
      }
      const data = await contactService.listChannelUsers(req.businessId, {
        platform, accountId: account_id, search, limit, offset,
      });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'listChannelUsers');
    }
  },
};
