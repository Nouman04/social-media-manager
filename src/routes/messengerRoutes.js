'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();
const messengerController = require('../controllers/messengerController');
const messengerOnboardingController = require('../controllers/messengerOnboardingController');
const authenticate = require('../middleware/authenticate');

// ─── PUBLIC ROUTES (no JWT) ───────────────────────────────────────────────────
// Meta's servers call the webhook endpoints directly — they carry no auth
// header. These MUST be registered before the JWT middleware below.
//
// The webhook itself now lives at the shared /api/v1/meta/webhook endpoint
// (see metaWebhookRoutes.js) rather than here — Instagram and Messenger
// deliver to that one Callback URL. WhatsApp keeps its own separate webhook.

/**
 * GET /api/v1/messenger/embedded-signup/config
 * Public: app id + Facebook Login config id for the connect page popup.
 */
router.get('/embedded-signup/config', messengerOnboardingController.getConfig);

/**
 * GET /api/v1/messenger/connect
 * Public: serves the vendor-facing Connect Messenger page.
 */
// router.get('/connect', (req, res) => {
//   res.sendFile(path.join(__dirname, '../public/messenger-connect.html'));
// });

/**
 * GET /api/v1/messenger/chat
 * Public: serves the live chat / inbox page. The page itself signs in and
 * calls the protected APIs with a JWT.
 */
// router.get('/chat', (req, res) => {
//   res.sendFile(path.join(__dirname, '../public/messenger-chat.html'));
// });

// ─── JWT Auth Middleware ───────────────────────────────────────────────────────
// Applied only to the routes defined AFTER this block.
// Unauthenticated / invalid-token requests are rejected with 401 here.
router.use(authenticate);

// ─── ACCOUNT MANAGEMENT ────────────────────────────────────────────────────────

/**
 * GET /api/v1/messenger/verify-credentials?page_id=&access_token=
 * Verify Page credentials against the Graph API before connecting.
 */
router.get('/verify-credentials', messengerController.verifyCredentials);

/**
 * POST /api/v1/messenger/account
 * Connect a Facebook Page.
 * Body: { business_id, page_id, access_token }
 */
router.post('/account', messengerController.addAccount);

/**
 * POST /api/v1/messenger/embedded-signup
 * Finish Embedded Signup: exchange code, subscribe the Page for messaging,
 * and store it against the business.
 * Body: { business_id, code, redirect_uri?, page_id? }
 */
router.post('/embedded-signup', messengerOnboardingController.completeSignup);

/**
 * GET /api/v1/messenger/account?business_id=
 * Fetch the connected Page (access token withheld).
 */
router.get('/account', messengerController.getAccount);

/**
 * PUT /api/v1/messenger/account
 * Update the connected Page — mainly to rotate an expiring token.
 * Body: { business_id, access_token?, is_active? }
 */
router.put('/account', messengerController.updateAccount);

/**
 * DELETE /api/v1/messenger/account?business_id=
 * Disconnect the Page (soft delete — history preserved).
 */
router.delete('/account', messengerController.deleteAccount);

// ─── PROFILE ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/messenger/profile?business_id=
 * Fetch the connected Page's own profile.
 */
router.get('/profile', messengerController.getProfile);

/**
 * GET /api/v1/messenger/contact-profile?business_id=&psid=
 * Fetch a contact's profile (name, avatar) by Page-Scoped ID.
 */
router.get('/contact-profile', messengerController.getContactProfile);

// ─── OUTBOUND MESSAGING ────────────────────────────────────────────────────────

/**
 * POST /api/v1/messenger/send/text
 * Send a text message (24-hour window applies unless a tag is used).
 * Body: { business_id, to, text, messaging_type?, message_tag?, receiver_id? }
 */
router.post('/send/text', messengerController.sendText);

/**
 * POST /api/v1/messenger/send/media
 * Send an image, video, audio, or file by public URL.
 * Body: { business_id, to, media_type, media_url, messaging_type?, message_tag?, receiver_id? }
 */
router.post('/send/media', messengerController.sendMedia);

/**
 * POST /api/v1/messenger/send/quick-replies
 * Send a text message with tappable quick-reply buttons.
 * Body: { business_id, to, text, quick_replies: [{ title, payload }], ... }
 */
router.post('/send/quick-replies', messengerController.sendQuickReplies);

/**
 * POST /api/v1/messenger/sender-action
 * Send a UI signal: mark_seen | typing_on | typing_off.
 * Body: { business_id, to, sender_action }
 */
router.post('/sender-action', messengerController.sendSenderAction);

// ─── INBOX ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/messenger/conversations?business_id=&limit=&offset=
 * List Messenger threads with a last-message preview.
 */
router.get('/conversations', messengerController.getConversations);

/**
 * GET /api/v1/messenger/messages?business_id=&conversation_id=&limit=&offset=
 * Fetch one thread's message history.
 */
router.get('/messages', messengerController.getMessages);

module.exports = router;
