'use strict';

const axios = require('axios');
const { WhatsappDetail, Business } = require('../../models');
const pendingSignup = require('../helpers/pendingSignup');

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
   * Every WhatsApp number a token grants access to, across all its WABAs.
   *
   * The browser only reports a WABA/number via the WA_EMBEDDED_SIGNUP
   * postMessage, and a Login-for-Business grant ("all current and future
   * WhatsApp accounts") may cover several. debug_token's granular scopes name
   * every WABA, and each lists its own numbers — so the user can choose
   * instead of us silently taking the first one.
   *
   * @param {string} accessToken
   * @returns {Promise<Array<{waba_id, phone_number_id, display_phone_number, verified_name}>>}
   */
  listNumbers: async (accessToken) => {
    const { appId, appSecret } = requireAppCredentials();
    let wabaIds;

    try {
      const res = await axios.get(GRAPH_API_BASE + '/debug_token', {
        params: { input_token: accessToken, access_token: appId + '|' + appSecret },
      });
      const scopes = (res.data?.data?.granular_scopes || [])
        .filter((s) => s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging');
      wabaIds = [...new Set(scopes.flatMap((s) => s.target_ids || []).map(String))];
    } catch (apiErr) {
      throw wrapMetaError(apiErr, 'listNumbers');
    }

    const perWaba = await Promise.all(wabaIds.map(async (wabaId) => {
      try {
        const res = await axios.get(GRAPH_API_BASE + '/' + wabaId + '/phone_numbers', {
          headers: { Authorization: 'Bearer ' + accessToken },
          params: { fields: 'id,display_phone_number,verified_name' },
        });
        return (res.data?.data || []).map((n) => ({
          waba_id: wabaId,
          phone_number_id: String(n.id),
          display_phone_number: n.display_phone_number || null,
          verified_name: n.verified_name || null,
        }));
      } catch (apiErr) {
        // One unreadable WABA shouldn't hide the numbers in the others.
        console.warn(`[whatsappOnboarding.listNumbers] Could not list numbers for WABA ${wabaId}:`, apiErr.message);
        return [];
      }
    }));

    return perWaba.flat();
  },

  /**
   * Run the whole Embedded Signup exchange and persist the result.
   *
   * When the browser did not report a number, nothing is saved: the numbers
   * come back with needs_selection and a selection_id (even when there is
   * only one), and the caller re-posts { selection_id, phone_number_id }
   * once per number to connect.
   *
   * @param {number} businessId  - Tenant the account is being connected to.
   * @param {object} payload     - { code | selection_id, redirect_uri?, waba_id?, phone_number_id?, pin? }
   * @param {number} userId      - Signed-in user; a selection_id only works for them.
   * @returns {Promise<object>}  - Stored account (without the token), or the number list.
   */
  completeEmbeddedSignup: async (businessId, {
    code, selection_id = null, waba_id, phone_number_id, pin = null, redirect_uri = null,
  }, userId) => {
    const business = await Business.findByPk(businessId);
    if (!business) {
      const err = new Error(`Business not found for business_id=${businessId}`);
      err.statusCode = 404;
      throw err;
    }

    // 2. code -> long-lived access token (or the one kept from an earlier login)
    let accessToken;
    if (selection_id) {
      const entry = pendingSignup.load(selection_id, { userId, businessId });
      if (!entry) throw pendingSignup.expiredError();
      accessToken = entry.userAccessToken;
    } else {
      accessToken = await whatsappOnboardingService.exchangeCodeForToken(code, redirect_uri);
    }

    // The WA_EMBEDDED_SIGNUP postMessage names exactly one WABA + number. When
    // it didn't (missed, or a plain Login-for-Business grant), read every
    // number the token covers and let the user choose.
    let numbers = [];
    let selectionId = selection_id;
    if (!waba_id || !phone_number_id) {
      numbers = await whatsappOnboardingService.listNumbers(accessToken);
      const candidates = numbers.filter((n) =>
        (!phone_number_id || n.phone_number_id === String(phone_number_id))
        && (!waba_id || n.waba_id === String(waba_id)));

      if (!selectionId && numbers.length) {
        selectionId = pendingSignup.save({ userId, businessId, userAccessToken: accessToken });
      }

      // No choice yet — always let the user pick, even from a single number.
      if (!phone_number_id && candidates.length) {
        return {
          needs_selection: true,
          selection_id: selectionId,
          available_numbers: await markConnected(businessId, numbers),
        };
      }

      waba_id = candidates[0]?.waba_id || null;
      phone_number_id = candidates[0]?.phone_number_id || null;
    }

    if (!waba_id || !phone_number_id) {
      const err = new Error(
        phone_number_id
          ? `phone_number_id "${phone_number_id}" is not among the numbers this login granted access to.`
          : 'Could not determine the WhatsApp account from this login. '
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
      // Other numbers this login covers, plus the selection_id that connects
      // another one without reopening the Facebook popup.
      selection_id: selectionId,
      available_numbers: await markConnected(businessId, numbers),
    };
  },
};

/** Flag which of a login's numbers this business has already connected. */
const markConnected = async (businessId, numbers) => {
  if (!numbers.length) return [];
  const connected = new Set((await WhatsappDetail.findAll({
    where: { business_id: businessId, phone_number_id: numbers.map((n) => n.phone_number_id) },
    attributes: ['phone_number_id'],
  })).map((d) => String(d.phone_number_id)));
  return numbers.map((n) => ({ ...n, connected: connected.has(n.phone_number_id) }));
};

module.exports = whatsappOnboardingService;
