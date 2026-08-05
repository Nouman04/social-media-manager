'use strict';

const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const passport = require('passport');
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

// ─── JWT Auth Middleware ───────────────────────────────────────────────────────
// Applied only to the routes defined AFTER this block.
router.use((req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    req.user = user;
    next();
  })(req, res, next);
});

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
 * Body: { business_id, to, media_type, media_url, caption?, filename? }
 */
router.post('/send/media', whatsappController.sendMedia);

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


