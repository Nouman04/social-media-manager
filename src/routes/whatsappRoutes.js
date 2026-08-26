'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const whatsappOnboardingController = require('../controllers/whatsappOnboardingController');
const authenticate = require('../middleware/authenticate');
const multer = require('multer');
const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } }); // Limit at 100MB per specs

// ─── PUBLIC ROUTES (no JWT) ───────────────────────────────────────────────────
// Meta's servers call the webhook endpoints directly — they carry no auth header.
// These MUST be registered before the JWT middleware below.

/**
 * GET /api/v1/whatsapp/webhook
 * Meta verification handshake — echoes hub.challenge when token matches.
 */
router.get('/webhook', whatsappController.verifyWebhook);

/**
 * POST /api/v1/whatsapp/webhook
 * Real-time event delivery (messages, status updates, account alerts).
 * Responds 200 immediately; processing is fire-and-forget.
 */
router.post('/webhook', whatsappController.handleWebhook);

/**
 * GET /api/v1/whatsapp/embedded-signup/config
 * Public: app id + Facebook Login config id for the connect page popup.
 */
router.get('/embedded-signup/config', whatsappOnboardingController.getConfig);

/**
 * GET /api/v1/whatsapp/connect
 * Public: serves the vendor-facing Connect WhatsApp page.
 */
router.get('/connect', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/whatsapp-connect.html'));
});

/**
 * GET /api/v1/whatsapp/chat
 * Public: serves the live chat / inbox page. The page itself signs in and
 * calls the protected APIs with a JWT.
 */
router.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/whatsapp-chat.html'));
});

// ─── JWT Auth Middleware ───────────────────────────────────────────────────────
// Applied only to the routes defined AFTER this block.
// Unauthenticated / invalid-token requests are rejected with 401 here.
router.use(authenticate);

// ─── PROTECTED ROUTES (require valid JWT) ────────────────────────────────────

/**
 * GET /api/v1/whatsapp/verify-credentials?phone_number_id=&access_token=
 * Verify WhatsApp Business credentials against the Graph API.
 */
router.get('/verify-credentials', whatsappController.verifyCredentials);

/**
 * GET /api/v1/whatsapp/business-profile?phone_number_id=&access_token=
 * Fetch the WhatsApp Business profile.
 */
router.get('/business-profile', whatsappController.getBusinessProfile);

/**
 * POST /api/v1/whatsapp/business-profile?phone_number_id=&access_token=
 * Update the WhatsApp Business profile.
 */
router.post('/business-profile', whatsappController.updateProfile);

// ─── ACCOUNT MANAGEMENT ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/whatsapp/account
 * Connect a vendor's WhatsApp Business Account (phone_number_id, waba_id, access_token).
 * Body: { business_id, phone_number_id, waba_id, access_token, display_phone_number? }
 */
router.post('/account', whatsappController.addAccount);

/**
 * POST /api/v1/whatsapp/embedded-signup
 * Finish Embedded Signup: exchange code, subscribe app to the WABA,
 * register the number, and store it against the business.
 * Body: { business_id, code, waba_id, phone_number_id, pin? }
 */
router.post('/embedded-signup', whatsappOnboardingController.completeSignup);

// ─── OUTBOUND MESSAGING ────────────────────────────────────────────────────────

/**
 * POST /api/v1/whatsapp/send/template
 * Send a pre-approved template message (initiates or reopens conversations).
 * Body: { business_id, to, template_name, language_code?, components? }
 */
router.post('/send/template', whatsappController.sendTemplate);

/**
 * POST /api/v1/whatsapp/send/text
 * Send a free-form text reply within an active 24-hour window.
 * Body: { business_id, to, body, preview_url? }
 */
router.post('/send/text', whatsappController.sendText);

/**
 * POST /api/v1/whatsapp/send/media
 * Send an image, document, audio, or video via public URL.
 * Accepts a raw file (multipart "file"), a media_id, or a public media_url.
 * Body: { business_id, to, media_type, [file|media_id|media_url], caption?, filename? }
 */
router.post('/send/media', upload.single('file'), whatsappController.sendMedia);

// ─── INBOX ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/whatsapp/conversations?business_id=&limit=&offset=
 * List chat threads with a last-message preview.
 */
router.get('/conversations', whatsappController.getConversations);

/**
 * GET /api/v1/whatsapp/messages?business_id=&conversation_id=|contact=
 * One thread's messages. Pass `contact` to open a chat for a raw number.
 */
router.get('/messages', whatsappController.getMessages);

// ─── TEMPLATE MANAGEMENT ───────────────────────────────────────────────────────

/**
 * GET /api/v1/whatsapp/templates?business_id=&force_sync=
 * Fetch existing templates (Meta API sync & DB cache with badge colors).
 */
router.get('/templates', whatsappController.getTemplates);

/**
 * POST /api/v1/whatsapp/templates
 * Create and submit a new template to Meta for review.
 * Body: { business_id, name, category, language?, components }
 */
router.post('/templates', whatsappController.createTemplate);

/**
 * DELETE /api/v1/whatsapp/templates?business_id=&name=
 * Delete a template from Meta and local DB.
 */
router.delete('/templates', whatsappController.deleteTemplate);

// ─── ACCOUNT HEALTH & QUALITY MONITORING ───────────────────────────────────────

/**
 * GET /api/v1/whatsapp/health?business_id=
 * Fetch and update account health parameters (quality rating, limit tier).
 */
router.get('/health', whatsappController.getAccountHealth);

// ─── MEDIA HANDLING ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/whatsapp/media
 * Upload a media file (Image/PDF etc) to Meta and get a media_id.
 */
router.post('/media', upload.single('file'), whatsappController.uploadMedia);

/**
 * GET /api/v1/whatsapp/media?business_id=&media_id=
 * Retrieve, download, and locally cache a media file.
 */
router.get('/media', whatsappController.downloadMedia);

module.exports = router;


