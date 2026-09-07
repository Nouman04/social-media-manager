'use strict';

const axios = require('axios');
const { MessengerDetail, Business } = require('../../models');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Normalise a Graph API failure into an Error carrying statusCode + metaError.
 */
const wrapMetaError = (apiErr, context) => {
  const errData = apiErr?.response?.data?.error || {};
  const errMsg = errData.message || apiErr.message;
  console.error(`[messengerOnboarding.${context}] FAILED | ${errMsg}`);
  const err = new Error(errMsg);
  err.statusCode = apiErr?.response?.status || 500;
  err.metaError = errData;
  return err;
};

const requireAppCredentials = () => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    const err = new Error(
      'META_APP_ID and META_APP_SECRET must be set in .env to complete Embedded Signup.'
    );
    err.statusCode = 500;
    throw err;
  }
  return { appId, appSecret };
};

const messengerOnboardingService = {

  /**
   * Public config the connect page needs to open the Facebook popup.
   * Messenger just needs pages_show_list + pages_messaging, both already
   * bundled into the shared Login config used for WhatsApp/Instagram — falls
   * back to META_CONFIG_ID unless a Messenger-specific config id is set.
   */
  getSignupConfig: () => ({
    app_id: process.env.META_APP_ID || null,
    config_id: process.env.META_MESSENGER_CONFIG_ID || process.env.META_CONFIG_ID || null,
    graph_version: GRAPH_VERSION,
    configured: Boolean(
      process.env.META_APP_ID && (process.env.META_MESSENGER_CONFIG_ID || process.env.META_CONFIG_ID)
    ),
  }),

  /**
   * Step 2 — swap the Embedded Signup authorization code for a user access token.
   *
   * @param {string} code
   * @param {string} [redirectUri] - Must match the dialog's redirect_uri exactly.
   * @returns {Promise<string>} access token
   */
  exchangeCodeForToken: async (code, redirectUri = null) => {
    const { appId, appSecret } = requireAppCredentials();
    const url = `${GRAPH_API_BASE}/oauth/access_token`;

    const params = { client_id: appId, client_secret: appSecret, code };
    if (redirectUri) params.redirect_uri = redirectUri;

    try {
      const response = await axios.get(url, { params });
      const token = response.data?.access_token;
      if (!token) {
        const err = new Error('Meta did not return an access_token for that code.');
        err.statusCode = 502;
        throw err;
      }
      return token;
    } catch (apiErr) {
      if (apiErr.statusCode) throw apiErr;
      throw wrapMetaError(apiErr, 'exchangeCodeForToken');
    }
  },

  /**
   * Step 3 — list the Facebook Pages this login granted access to, each with
   * its own Page access token. Unlike Instagram, Messenger needs nothing
   * beyond the Page itself — no linked professional account required.
   *
   * @param {string} userAccessToken
   * @returns {Promise<Array<{id, name, access_token}>>}
   */
  listPages: async (userAccessToken) => {
    const url = `${GRAPH_API_BASE}/me/accounts`;
    try {
      const response = await axios.get(url, {
        params: { fields: 'id,name,access_token', access_token: userAccessToken },
      });
      return response.data?.data || [];
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'listPages');
    }
  },

  /**
   * Step 4 — subscribe our app to the Page so Messenger webhooks actually
   * arrive. Without this, Meta accepts the webhook verification but never
   * delivers a single inbound message.
   */
  subscribePageForMessaging: async (pageId, pageAccessToken) => {
    const url = `${GRAPH_API_BASE}/${pageId}/subscribed_apps`;
    try {
      const response = await axios.post(url, null, {
        params: { subscribed_fields: 'messages,messaging_postbacks,message_reactions,message_reads' },
        headers: { Authorization: `Bearer ${pageAccessToken}` },
      });
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'subscribePageForMessaging');
    }
  },

  /**
   * Run the whole Embedded Signup exchange and persist the result.
   *
   * @param {number} businessId  - Tenant the account is being connected to.
   * @param {object} payload     - { code, redirect_uri?, page_id? }
   *                                page_id lets the caller pick a specific Page
   *                                when the login granted access to several.
   * @returns {Promise<object>}  - Stored account (without the token).
   */
  completeEmbeddedSignup: async (businessId, { code, page_id = null, redirect_uri = null }) => {
    const business = await Business.findByPk(businessId);
    if (!business) {
      const err = new Error(`Business not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    // 2. code -> user access token
    const userAccessToken = await messengerOnboardingService.exchangeCodeForToken(code, redirect_uri);

    // 3. find the Page this login grants access to
    const pages = await messengerOnboardingService.listPages(userAccessToken);

    let page = page_id
      ? pages.find((p) => String(p.id) === String(page_id))
      : pages[0];

    if (!page) {
      const err = new Error(
        page_id
          ? `page_id "${page_id}" was not among the Pages this login granted access to.`
          : 'This Facebook login did not grant access to any Page. '
            + 'Make sure the account is an admin of at least one Facebook Page, then try again.'
      );
      err.statusCode = 422;
      err.pages = pages.map((p) => ({ id: p.id, name: p.name }));
      throw err;
    }

    const pageAccessToken = page.access_token;

    // Another business already owns this Page — refuse rather than hijack it.
    const clash = await MessengerDetail.findOne({
      where: { page_id: page.id },
      paranoid: false,
    });
    if (clash && clash.business_id !== Number(businessId)) {
      const err = new Error(`Page "${page.name}" is already connected to another business.`);
      err.statusCode = 409;
      throw err;
    }

    // 4. subscribe our app so inbound webhooks actually arrive
    await messengerOnboardingService.subscribePageForMessaging(page.id, pageAccessToken);

    // 5. persist — upsert so reconnecting refreshes the token in place
    const values = {
      business_id: businessId,
      page_id: page.id,
      page_name: page.name || null,
      access_token: pageAccessToken,
      is_active: true,
    };

    let detail;
    if (clash) {
      await clash.restore().catch(() => {});
      await clash.update(values);
      detail = clash;
    } else {
      detail = await MessengerDetail.create(values);
    }

    console.log(`[messengerOnboarding] Connected | tenant=${businessId} | page=${page.id}`);

    const plain = detail.toJSON();
    delete plain.access_token;

    return {
      account: plain,
      page_name: page.name || null,
      // Every Page the login granted access to — lets the connect page offer
      // a picker when there's more than one.
      available_pages: pages.map((p) => ({ page_id: p.id, page_name: p.name })),
    };
  },
};

module.exports = messengerOnboardingService;
