'use strict';

const axios = require('axios');
const { WhatsappDetail, Business } = require('../../models');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Normalise a Graph API failure into an Error carrying statusCode + metaError.
 */
const wrapMetaError = (apiErr, context) => {
  const errData = apiErr?.response?.data?.error || {};
  const errMsg = errData.message || apiErr.message;
  console.error(`[whatsappOnboarding.${context}] FAILED | ${errMsg}`);
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

const whatsappOnboardingService = {

  /**
   * Public config the connect page needs to open the Facebook popup.
   * App ID and config ID are not secrets — they ship in the browser either way.
   */
  getSignupConfig: () => ({
    app_id: process.env.META_APP_ID || null,
    config_id: process.env.META_CONFIG_ID || null,
    graph_version: GRAPH_VERSION,
    configured: Boolean(process.env.META_APP_ID && process.env.META_CONFIG_ID),
  }),

  /**
   * Step 2 — swap the Embedded Signup authorization code for an access token.
   *
   * Unlike the temporary dashboard token, the token returned here is
   * long-lived, so vendors don't have to reconnect every day.
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
   * Step 3 — subscribe OUR app to the vendor's WABA.
   *
   * Without this, Meta accepts the webhook verification but never delivers a
   * single inbound message. It is the most commonly missed step.
   */
  subscribeAppToWaba: async (wabaId, accessToken) => {
    const url = `${GRAPH_API_BASE}/${wabaId}/subscribed_apps`;
    try {
      const response = await axios.post(url, {}, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'subscribeAppToWaba');
    }
  },

  /**
   * Step 4 — register the phone number for Cloud API messaging.
   *
   * A number that is already registered returns an error we can safely treat
   * as success, so re-running onboarding stays idempotent.
   */
  registerPhoneNumber: async (phoneNumberId, accessToken, pin = null) => {
    const url = `${GRAPH_API_BASE}/${phoneNumberId}/register`;
    const body = {
      messaging_product: 'whatsapp',
      pin: pin || process.env.WHATSAPP_REGISTER_PIN || '000000',
    };

    try {
      const response = await axios.post(url, body, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { registered: true, data: response.data };
    } catch (apiErr) {
      const code = apiErr?.response?.data?.error?.code;
      const sub = apiErr?.response?.data?.error?.error_subcode;
      // 133005 = already registered, 133010 = not deregistered / already in use
      if (code === 133005 || sub === 2388008 || code === 133010) {
        console.warn(`[whatsappOnboarding.registerPhoneNumber] ${phoneNumberId} already registered — continuing.`);
        return { registered: false, alreadyRegistered: true };
      }
      throw wrapMetaError(apiErr, 'registerPhoneNumber');
    }
  },

  /**
   * Fetch the number's display value so the UI can show it back to the vendor.
   */
  getPhoneNumberInfo: async (phoneNumberId, accessToken) => {
    const url = `${GRAPH_API_BASE}/${phoneNumberId}`;
    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'display_phone_number,verified_name,quality_rating' },
      });
      return response.data;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'getPhoneNumberInfo');
    }
  },

  /**
   * Work out which WABA and phone number a token grants access to.
   *
   * The browser normally reports these via the WA_EMBEDDED_SIGNUP postMessage,
   * but that can be missed (popup blockers, browser quirks, a flow that ended
   * early). debug_token exposes the same information server-side through the
   * granular scopes attached to the token, so onboarding does not have to
   * depend on the front end getting it right.
   *
   * @param {string} accessToken
   * @returns {Promise<{waba_id: string|null, phone_number_id: string|null}>}
   */
  discoverAccount: async (accessToken) => {
    const { appId, appSecret } = requireAppCredentials();
    let wabaId = null;

    try {
      const res = await axios.get(GRAPH_API_BASE + '/debug_token', {
        params: { input_token: accessToken, access_token: appId + '|' + appSecret },
      });
      const scopes = res.data?.data?.granular_scopes || [];
      const waScope = scopes.find((s) => s.scope === 'whatsapp_business_management')
        || scopes.find((s) => s.scope === 'whatsapp_business_messaging');
      wabaId = waScope?.target_ids?.[0] || null;
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'discoverAccount');
    }

    if (!wabaId) return { waba_id: null, phone_number_id: null };

    try {
      const res = await axios.get(GRAPH_API_BASE + '/' + wabaId + '/phone_numbers', {
        headers: { Authorization: 'Bearer ' + accessToken },
        params: { fields: 'id,display_phone_number,verified_name' },
      });
      const first = (res.data?.data || [])[0];
      return { waba_id: wabaId, phone_number_id: first?.id || null };
    } catch (apiErr) {
      console.warn('[whatsappOnboarding.discoverAccount] Could not list phone numbers:', apiErr.message);
      return { waba_id: wabaId, phone_number_id: null };
    }
  },

  /**
   * Run the whole Embedded Signup exchange and persist the result.
   *
   * @param {number} businessId  - Tenant the account is being connected to.
   * @param {object} payload     - { code, redirect_uri?, waba_id?, phone_number_id?, pin? }
   * @returns {Promise<object>}  - Stored account (without the token).
   */
  completeEmbeddedSignup: async (businessId, { code, waba_id, phone_number_id, pin = null, redirect_uri = null }) => {
    const business = await Business.findByPk(businessId);
    if (!business) {
      const err = new Error(`Business not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    // 2. code -> long-lived access token (done first: the token is what lets us
    // discover the account when the browser did not report it).
    const accessToken = await whatsappOnboardingService.exchangeCodeForToken(code, redirect_uri);

    // The WA_EMBEDDED_SIGNUP postMessage is the normal source of these ids, but
    // it can be missed. Fall back to reading them from the token itself.
    if (!waba_id || !phone_number_id) {
      const found = await whatsappOnboardingService.discoverAccount(accessToken);
      waba_id = waba_id || found.waba_id;
      phone_number_id = phone_number_id || found.phone_number_id;
      console.log(`[whatsappOnboarding] Discovered from token | waba=${waba_id} | phone=${phone_number_id}`);
    }

    if (!waba_id || !phone_number_id) {
      const err = new Error(
        'Could not determine the WhatsApp account from this login. '
        + 'Make sure a phone number was added during the Facebook flow, then try again.'
      );
      err.statusCode = 422;
      throw err;
    }

    // Another business already owns this number — refuse rather than hijack it.
    const clash = await WhatsappDetail.findOne({
      where: { phone_number_id },
      paranoid: false,
    });
    if (clash && clash.business_id !== Number(businessId)) {
      const err = new Error(`phone_number_id "${phone_number_id}" is already connected to another business.`);
      err.statusCode = 409;
      throw err;
    }

    // 3. subscribe our app so inbound webhooks actually arrive
    await whatsappOnboardingService.subscribeAppToWaba(waba_id, accessToken);

    // 4. register the number for Cloud API (idempotent)
    const registration = await whatsappOnboardingService.registerPhoneNumber(phone_number_id, accessToken, pin);

    // 5. read back the display number for the UI
    let info = {};
    try {
      info = await whatsappOnboardingService.getPhoneNumberInfo(phone_number_id, accessToken);
    } catch (infoErr) {
      console.warn('[whatsappOnboarding] Could not read phone number info:', infoErr.message);
    }

    const displayPhone = (info.display_phone_number || '').replace(/\D/g, '') || null;

    // 6. persist — upsert so reconnecting refreshes the token in place
    const values = {
      business_id: businessId,
      phone_number_id,
      waba_id,
      access_token: accessToken,
      display_phone_number: displayPhone,
      is_active: true,
    };

    let detail;
    if (clash) {
      await clash.restore().catch(() => {});
      await clash.update(values);
      detail = clash;
    } else {
      detail = await WhatsappDetail.create(values);
    }

    console.log(`[whatsappOnboarding] Connected | tenant=${businessId} | waba=${waba_id} | phone=${phone_number_id}`);

    const plain = detail.toJSON();
    delete plain.access_token;

    return {
      account: plain,
      verified_name: info.verified_name || null,
      display_phone_number: info.display_phone_number || null,
      phone_registered: registration.registered,
      already_registered: Boolean(registration.alreadyRegistered),
    };
  },
};

module.exports = whatsappOnboardingService;
