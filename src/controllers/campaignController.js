'use strict';

const campaignService = require('../services/campaignService');

/**
 * Shared error responder — forwards the service's statusCode and any
 * Graph API error detail attached to it.
 */
const fail = (res, err, context) => {
  console.error(`[campaignController.${context}] Error:`, err.message);
  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    ...(err.metaError && { metaError: err.metaError }),
  });
};

// Every handler runs behind authorizeBusiness (req.businessId is trusted).
module.exports = {

  /**
   * POST /api/v1/campaigns/audience-preview
   * Body: { business_id, audience: { tags?, contact_ids? } }
   * How many opted-in contacts the audience reaches, plus a small sample.
   */
  previewAudience: async (req, res) => {
    try {
      const data = await campaignService.previewAudience(req.businessId, req.body.audience || {});
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'previewAudience');
    }
  },

  /**
   * POST /api/v1/campaigns
   * Body: { business_id, name, account_id?, template_name, language?,
   *         variables?: ["{{contact.name|Customer}}", "20% off"],
   *         audience?: { tags?: [], contact_ids?: [] } }
   * Saves a draft; nothing is sent until POST /:id/send.
   */
  createCampaign: async (req, res) => {
    try {
      const data = await campaignService.createCampaign(req.businessId, req.user.id, req.body);
      return res.status(201).json({ success: true, message: 'Campaign created', ...data });
    } catch (err) {
      return fail(res, err, 'createCampaign');
    }
  },

  /**
   * GET /api/v1/campaigns?business_id=&limit=&offset=
   */
  listCampaigns: async (req, res) => {
    try {
      const data = await campaignService.listCampaigns(req.businessId, req.query);
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'listCampaigns');
    }
  },

  /**
   * GET /api/v1/campaigns/:id?business_id=
   * Campaign with its funnel: total / queued / sent / delivered / read / failed.
   */
  getCampaign: async (req, res) => {
    try {
      const data = await campaignService.getCampaign(req.businessId, req.params.id);
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'getCampaign');
    }
  },

  /**
   * POST /api/v1/campaigns/:id/send
   * Body: { business_id }
   * Freezes the audience and starts sending in the background (202). Calling
   * it again resumes recipients still queued.
   */
  sendCampaign: async (req, res) => {
    try {
      const data = await campaignService.sendCampaign(req.businessId, req.params.id);
      return res.status(202).json({ success: true, message: 'Campaign is sending', ...data });
    } catch (err) {
      return fail(res, err, 'sendCampaign');
    }
  },

  /**
   * POST /api/v1/campaigns/send-text
   * Body: { business_id, account_id?, contact_ids: [..], body }
   * Free-form text to up to 50 chosen contacts — delivered only inside their
   * 24h window. Answers with a per-contact result.
   */
  sendText: async (req, res) => {
    try {
      const data = await campaignService.sendTextToContacts(req.businessId, req.user.id, req.body);
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'sendText');
    }
  },

  /**
   * GET /api/v1/campaigns/:id/recipients?business_id=&status=&limit=&offset=
   * status: queued | sent | failed
   */
  getRecipients: async (req, res) => {
    try {
      const { status, limit, offset } = req.query;
      const data = await campaignService.getRecipients(req.businessId, req.params.id, { status, limit, offset });
      return res.status(200).json({ success: true, ...data });
    } catch (err) {
      return fail(res, err, 'getRecipients');
    }
  },
};
