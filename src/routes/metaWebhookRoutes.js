'use strict';

const express = require('express');
const router = express.Router();
const metaWebhookController = require('../controllers/metaWebhookController');

// Shared endpoint for Instagram and Messenger webhooks (both go through
// Facebook Login for Business). WhatsApp keeps its own separate webhook at
// /api/v1/whatsapp/webhook. No auth — Meta's servers call this directly and
// carry no Bearer token, so this stays outside the JWT middleware entirely.

/**
 * GET /api/v1/meta/webhook
 * Meta verification handshake — echoes hub.challenge when the token matches.
 */
router.get('/webhook', metaWebhookController.verifyWebhook);

/**
 * POST /api/v1/meta/webhook
 * Real-time event delivery for Instagram and Messenger.
 * Responds 200 immediately; processing is fire-and-forget, routed by the
 * payload's `object` field to the matching platform service.
 */
router.post('/webhook', metaWebhookController.handleWebhook);

module.exports = router;
