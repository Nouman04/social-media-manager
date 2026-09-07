'use strict';

const onboarding = require('../services/messengerOnboardingService');
const { BusinessUser } = require('../../models');

const fail = (res, err, context) => {
  console.error(`[messengerOnboardingController.${context}] Error:`, err.message);
  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    ...(err.metaError && { metaError: err.metaError }),
    ...(err.pages && { pages: err.pages }),
  });
};

module.exports = {

  /**
   * GET /api/v1/messenger/embedded-signup/config
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
        : { message: 'Set META_APP_ID and META_MESSENGER_CONFIG_ID (or META_CONFIG_ID) in .env to enable Embedded Signup.' }),
    });
  },

  /**
   * POST /api/v1/messenger/embedded-signup
   *
   * Completes onboarding after the vendor finishes the Facebook popup:
   * exchanges the code for a Page access token, subscribes this app to the
   * Page, and stores it against their business.
   *
   * Body: { business_id, code, redirect_uri?, page_id? }
   */
  completeSignup: async (req, res) => {
    try {
      const { business_id, code, page_id, redirect_uri } = req.body;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!code) missing.push('code is required (from the Facebook popup)');

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
        redirect_uri,
        page_id,
      });

      return res.status(201).json({
        success: true,
        message: 'Facebook Page connected successfully',
        ...result,
      });
    } catch (err) {
      return fail(res, err, 'completeSignup');
    }
  },
};
