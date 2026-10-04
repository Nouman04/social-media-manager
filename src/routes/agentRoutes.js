'use strict';

const express = require('express');
const path    = require('path');
const router  = express.Router();
const agentController = require('../controllers/agentController');
const authenticate    = require('../middleware/authenticate');

// ─── PUBLIC ROUTES (no JWT) ──────────────────────────────────────────────────

/**
 * GET /api/v1/agent/connect
 * Serves the agent-connect UI page.
 */
router.get('/connect', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agent-connect.html'));
});

// ─── JWT Auth Middleware ──────────────────────────────────────────────────────
router.use(authenticate);

// ─── PROTECTED ROUTES (require valid JWT) ────────────────────────────────────

/**
 * GET  /api/v1/agent/settings?business_id=
 * Fetch current agent settings (API key masked).
 */
router.get('/settings', agentController.getSettings);

/**
 * POST /api/v1/agent/settings
 * Save / update agent settings.
 * Body: { business_id, openrouter_api_key?, model?, system_prompt? }
 */
router.post('/settings', agentController.saveSettings);

/**
 * POST /api/v1/agent/verify-key
 * Check if an OpenRouter API key is valid (does not save it).
 * Body: { api_key }
 */
router.post('/verify-key', agentController.verifyApiKey);

/**
 * POST /api/v1/agent/chat
 * Send a prompt to the agent and get a reply.
 * Body: { business_id, prompt, history? }
 */
router.post('/chat', agentController.chat);

module.exports = router;
