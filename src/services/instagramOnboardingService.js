'use strict';

const axios = require('axios');
const { InstagramDetail, Business } = require('../../models');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Normalise a Graph API failure into an Error carrying statusCode + metaError.
 */
const wrapMetaError = (apiErr, context) => {
  const errData = apiErr?.response?.data?.error || {};
  const errMsg = errData.message || apiErr.message;
  console.error(`[instagramOnboarding.${context}] FAILED | ${errMsg}`);
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

const instagramOnboardingService = {

  /**
   * Public config the connect page needs to open the Facebook popup.
   *
   * Instagram needs a different permission bundle than WhatsApp (instagram_basic,
   * instagram_manage_messages, pages_show_list, pages_manage_metadata,
   * pages_messaging) so it normally has its own Facebook Login for Business
   * configuration. Falls back to the WhatsApp config id when no Instagram-
   * specific one is set, since one config can bundle both product's scopes if
   * it was set up that way in the Meta App Dashboard.
   */
  getSignupConfig: () => ({
    app_id: process.env.META_APP_ID || null,
    config_id: process.env.META_INSTAGRAM_CONFIG_ID || process.env.META_CONFIG_ID || null,
    graph_version: GRAPH_VERSION,
    configured: Boolean(
      process.env.META_APP_ID && (process.env.META_INSTAGRAM_CONFIG_ID || process.env.META_CONFIG_ID)
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

    // Meta validates the code against the redirect_uri used in the dialog, so
    // the exact same value has to be replayed here or it rejects with 36008.
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
   * List the Facebook Pages this login granted access to, each with its own
   * Page access token and (when linked) Instagram Professional account.
   *
   * A Page's own access token — not the user token from step 2 — is what the
   * Instagram Messaging API actually accepts for sending/receiving DMs.
   *
   * @param {string} userAccessToken
   * @returns {Promise<Array<{id, name, access_token, instagram_business_account}>>}
   */
  listPagesViaMeAccounts: async (userAccessToken) => {
    const url = `${GRAPH_API_BASE}/me/accounts`;
    try {
      const response = await axios.get(url, {
        params: {
          fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count}',
          access_token: userAccessToken,
        },
      });
      return response.data?.data || [];
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'listPagesViaMeAccounts');
    }
  },

  /**
   * Facebook Login for Business (config_id-based) issues a "Business
   * Integration" token rather than a normal personal-login token. That kind
   * of token frequently returns an empty or incomplete list from
   * /me/accounts even when the Page and its Instagram link are set up
   * correctly — /me doesn't resolve the way it does for a classic login.
   *
   * debug_token side-steps that: it reports exactly which Page ids each
   * granted permission is scoped to (granular_scopes), regardless of how "me"
   * behaves for this token type. Reading each of those Page ids directly then
   * works reliably.
   *
   * @param {string} userAccessToken
   * @returns {Promise<{pageIds: string[], scopes: string[]}>}
   */
  discoverGrantedPageIds: async (userAccessToken) => {
    const { appId, appSecret } = requireAppCredentials();
    try {
      const response = await axios.get(`${GRAPH_API_BASE}/debug_token`, {
        params: { input_token: userAccessToken, access_token: `${appId}|${appSecret}` },
      });
      const granular = response.data?.data?.granular_scopes || [];
      const scopes = granular.map((s) => s.scope);
      const relevant = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'instagram_basic', 'instagram_manage_messages'];
      const ids = new Set();
      granular
        .filter((s) => relevant.includes(s.scope))
        .forEach((s) => (s.target_ids || []).forEach((id) => ids.add(id)));
      return { pageIds: Array.from(ids), scopes };
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'discoverGrantedPageIds');
    }
  },

  /**
   * Read one Page node directly by id — the fallback path when /me/accounts
   * doesn't surface it for this token type.
   */
  fetchPageById: async (pageId, userAccessToken) => {
    try {
      const response = await axios.get(`${GRAPH_API_BASE}/${pageId}`, {
        params: {
          fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count}',
          access_token: userAccessToken,
        },
      });
      return response.data;
    } catch (apiErr) {
      console.warn(`[instagramOnboarding.fetchPageById] Could not read page ${pageId}:`, apiErr?.response?.data?.error?.message || apiErr.message);
      return null;
    }
  },

  /**
   * Combines both discovery paths: try /me/accounts first (works for a
   * classic login), then fill in anything it missed by reading Page ids
   * straight from the token's granted scopes. Logs a summary either way so a
   * failed connect attempt is diagnosable from the server console.
   *
   * @param {string} userAccessToken
   * @returns {Promise<Array<{id, name, access_token, instagram_business_account}>>}
   */
  listPagesWithInstagram: async (userAccessToken) => {
    const viaMe = await instagramOnboardingService.listPagesViaMeAccounts(userAccessToken);
    const byId = new Map(viaMe.map((p) => [String(p.id), p]));

    if (!viaMe.some((p) => p.instagram_business_account)) {
      const { pageIds, scopes } = await instagramOnboardingService.discoverGrantedPageIds(userAccessToken);
      const missing = pageIds.filter((id) => !byId.has(String(id)));

      if (missing.length) {
        const fetched = await Promise.all(missing.map((id) => instagramOnboardingService.fetchPageById(id, userAccessToken)));
        fetched.filter(Boolean).forEach((p) => byId.set(String(p.id), p));
      }

      console.log(
        `[instagramOnboarding] /me/accounts returned ${viaMe.length} page(s); ` +
        `granted scopes: [${scopes.join(', ')}]; granted page ids: [${pageIds.join(', ')}]`
      );
    }

    const pages = Array.from(byId.values());
    console.log(
      '[instagramOnboarding] Pages discovered: ' +
      (pages.length
        ? pages.map((p) => `${p.name || p.id}${p.instagram_business_account ? ` (@${p.instagram_business_account.username})` : ' (no Instagram linked)'}`).join('; ')
        : 'none')
    );

    return pages;
  },

  /**
   * Step 4 — subscribe our app to the Page so Instagram DM webhooks actually
   * arrive. Without this, Meta accepts the webhook verification but never
   * delivers a single inbound message — the most commonly missed step.
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
    const userAccessToken = await instagramOnboardingService.exchangeCodeForToken(code, redirect_uri);

    // 3. find the Page (+ linked Instagram account) this login grants access to
    const pages = await instagramOnboardingService.listPagesWithInstagram(userAccessToken);
    const withInstagram = pages.filter((p) => p.instagram_business_account);

    let page = page_id
      ? withInstagram.find((p) => String(p.id) === String(page_id))
      : withInstagram[0];

    if (!page) {
      let message;
      if (withInstagram.length) {
        message = `page_id "${page_id}" was not among the Pages this login granted access to.`;
      } else if (pages.length) {
        message = 'None of the Facebook Pages granted access to have an Instagram Professional account linked. '
          + 'Link an Instagram Business/Creator account to the Page in Meta Business Suite, then try again.';
      } else {
        // No pages at all — usually a permission problem rather than a
        // missing Instagram link. Report what the token was actually
        // granted so it's diagnosable without re-running with logs open.
        const { scopes } = await instagramOnboardingService.discoverGrantedPageIds(userAccessToken).catch(() => ({ scopes: [] }));
        message = 'This Facebook login did not grant access to any Page at all. '
          + (scopes.length
            ? `Permissions actually granted: [${scopes.join(', ')}]. `
            : 'No permissions were reported for this token — the login config may be missing the pages_show_list / instagram_basic scopes. ')
          + 'Make sure the Facebook account is an admin of a Page with a linked Instagram Business/Creator account, '
          + 'and that the Meta Login config includes pages_show_list, instagram_basic, instagram_manage_messages and pages_messaging.';
      }

      const err = new Error(message);
      err.statusCode = 422;
      err.pages = pages.map((p) => ({ id: p.id, name: p.name, has_instagram: Boolean(p.instagram_business_account) }));
      throw err;
    }

    const igAccount = page.instagram_business_account;
    const pageAccessToken = page.access_token;

    // Another business already owns this Instagram account — refuse rather than hijack it.
    const clash = await InstagramDetail.findOne({
      where: { ig_user_id: igAccount.id },
      paranoid: false,
    });
    if (clash && clash.business_id !== Number(businessId)) {
      const err = new Error(`Instagram account "@${igAccount.username}" is already connected to another business.`);
      err.statusCode = 409;
      throw err;
    }

    // 4. subscribe our app so inbound webhooks actually arrive
    await instagramOnboardingService.subscribePageForMessaging(page.id, pageAccessToken);

    // 5. persist — upsert so reconnecting refreshes the token in place
    //
    // ig_scoped_id is deliberately not set here. It belongs to the Instagram
    // Login pipeline; this is Facebook Login, whose threads report the plain
    // ig_user_id as the participant id (confirmed against the live API), and
    // whose IG User node has no user_id field to read it from. Leaving it null
    // is correct — processWebhookEvent matches on either id.
    const values = {
      business_id: businessId,
      ig_user_id: igAccount.id,
      page_id: page.id,
      username: igAccount.username || null,
      access_token: pageAccessToken,
      is_active: true,
    };
    let detail;
    if (clash) {
      await clash.restore().catch(() => {});
      await clash.update(values);
      detail = clash;
    } else {
      detail = await InstagramDetail.create(values);
    }

    console.log(`[instagramOnboarding] Connected | tenant=${businessId} | ig_user_id=${igAccount.id} | page=${page.id}`);

    const plain = detail.toJSON();
    delete plain.access_token;

    return {
      account: plain,
      username: igAccount.username || null,
      followers_count: igAccount.followers_count ?? null,
      page_name: page.name || null,
      // Every Page with an Instagram account the login granted access to —
      // lets the connect page offer a picker when there's more than one.
      available_pages: withInstagram.map((p) => ({
        page_id: p.id,
        page_name: p.name,
        ig_user_id: p.instagram_business_account.id,
        username: p.instagram_business_account.username,
      })),
    };
  },
};

module.exports = instagramOnboardingService;
