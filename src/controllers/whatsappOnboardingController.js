'use strict';

const onboarding = require('../services/whatsappOnboardingService');
const { BusinessUser } = require('../../models');

const fail = (res, err, context) => {
  console.error(`[whatsappOnboardingController.${context}] Error:`, err.message);
  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    ...(err.metaError && { metaError: err.metaError }),
  });
};

module.exports = {

  /**
   * GET /api/v1/whatsapp/embedded-signup/config
   *
   * Public: the connect page needs the app id and Facebook Login config id to
   * open the popup. Neither is a secret — both are visible in the browser.
   */
  getConfig: (req, res) => {
    const cfg = onboarding.getSignupConfig();
    return res.status(200).json({
      success: true,
      ...cfg,
      ...(cfg.configured
        ? {}
        : { message: 'Set META_APP_ID and META_CONFIG_ID in .env to enable Embedded Signup.' }),
    });
  },

  /**
   * POST /api/v1/whatsapp/embedded-signup
   *
   * Completes onboarding after the vendor finishes the Facebook popup:
   * exchanges the code for a long-lived token, subscribes this app to their
   * WABA, registers the number, and stores it against their business.
   *
   * Body: { business_id, code | selection_id, redirect_uri?, waba_id?, phone_number_id?, pin? }
   *
   * With several numbers and none chosen, nothing is saved yet: the response
   * is { needs_selection: true, selection_id, available_numbers } and the page
   * re-posts { business_id, selection_id, phone_number_id } for each pick.
   */
  completeSignup: async (req, res) => {
    try {
      const { business_id, code, selection_id, waba_id, phone_number_id, pin, redirect_uri } = req.body;

      const missing = [];
      if (!business_id)     missing.push('business_id is required');
      if (!code && !selection_id) missing.push('code (from the Facebook popup) or selection_id is required');
      // waba_id / phone_number_id are optional: when the browser fails to
      // report them, the service reads them back from the exchanged token.

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      // The caller must actually belong to the business they are connecting.
      const membership = await BusinessUser.findOne({
        where: { business_id, user_id: req.user.id, is_active: true },
      });
      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this business',
        });
      }

      const result = await onboarding.completeEmbeddedSignup(business_id, {
        code,
        selection_id,
        redirect_uri,
        waba_id,
        phone_number_id,
        pin,
      }, req.user.id);

      if (result.needs_selection) {
        return res.status(200).json({ success: true, message: 'Choose which WhatsApp number to connect', ...result });
      }

      return res.status(201).json({
        success: true,
        message: 'WhatsApp account connected successfully',
        ...result,
      });
    } catch (err) {
      return fail(res, err, 'completeSignup');
    }
  },
};
