'use strict';

const express = require('express');
const router = express.Router();
const instagramController = require('../controllers/instagramController');
const authenticate = require('../middleware/authenticate');

// ─── PUBLIC ROUTES (no JWT) ───────────────────────────────────────────────────
// Meta's servers call the webhook endpoints directly — they carry no auth
// header. These MUST be registered before the JWT middleware below.

/**
 * GET /api/v1/instagram/webhook
 * Meta verification handshake — echoes hub.challenge when the token matches.
 */
router.get('/webhook', instagramController.verifyWebhook);

/**
 * POST /api/v1/instagram/webhook
 * Real-time event delivery (direct messages, read/delivery receipts).
 * Responds 200 immediately; processing is fire-and-forget.
 */
router.post('/webhook', instagramController.handleWebhook);

// ─── JWT Auth Middleware ───────────────────────────────────────────────────────
// Applied only to the routes defined AFTER this block.
// Unauthenticated / invalid-token requests are rejected with 401 here.
router.use(authenticate);

// ─── ACCOUNT MANAGEMENT ────────────────────────────────────────────────────────

/**
 * GET /api/v1/instagram/verify-credentials?ig_user_id=&access_token=
 * Verify Instagram credentials against the Graph API before connecting.
 */
router.get('/verify-credentials', instagramController.verifyCredentials);

/**
 * POST /api/v1/instagram/account
 * Connect an Instagram Professional account.
 * Body: { business_id, ig_user_id, page_id, access_token }
 */
router.post('/account', instagramController.addAccount);

/**
 * GET /api/v1/instagram/account?business_id=
 * Fetch the connected account (access token withheld).
 */
router.get('/account', instagramController.getAccount);

/**
 * PUT /api/v1/instagram/account
 * Update the connected account — mainly to rotate an expiring token.
 * Body: { business_id, page_id?, access_token?, is_active? }
 */
router.put('/account', instagramController.updateAccount);

/**
 * DELETE /api/v1/instagram/account?business_id=
 * Disconnect the account (soft delete — history preserved).
 */
router.delete('/account', instagramController.deleteAccount);

// ─── PROFILE ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/instagram/profile?business_id=
 * Fetch the connected account's own Instagram profile.
 */
router.get('/profile', instagramController.getProfile);

/**
 * GET /api/v1/instagram/contact-profile?business_id=&igsid=
 * Fetch a contact's public profile (name, avatar) by scoped ID.
 */
router.get('/contact-profile', instagramController.getContactProfile);

// ─── OUTBOUND MESSAGING ────────────────────────────────────────────────────────

/**
 * POST /api/v1/instagram/send/text
 * Send a text Direct message (24-hour window applies).
 * Body: { business_id, to, text, receiver_id? }
 */
router.post('/send/text', instagramController.sendText);

/**
 * POST /api/v1/instagram/send/media
 * Send an image, video, audio, or file by public URL.
 * Body: { business_id, to, media_type, media_url, receiver_id? }
 */
router.post('/send/media', instagramController.sendMedia);

/**
 * POST /api/v1/instagram/send/reaction
 * React (or un-react) to a message.
 * Body: { business_id, to, message_id, reaction?, unreact? }
 */
router.post('/send/reaction', instagramController.sendReaction);

/**
 * POST /api/v1/instagram/mark-seen
 * Mark the conversation as seen (blue tick).
 * Body: { business_id, to }
 */
router.post('/mark-seen', instagramController.markSeen);

// ─── INBOX ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/instagram/conversations?business_id=&limit=&offset=
 * List Instagram threads with a last-message preview.
 */
router.get('/conversations', instagramController.getConversations);

/**
 * GET /api/v1/instagram/messages?business_id=&conversation_id=&limit=&offset=
 * Fetch one thread's message history.
 */
router.get('/messages', instagramController.getMessages);

module.exports = router;
