'use strict';

const agentService = require('../services/agentService');

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  1. GET SETTINGS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/agent/settings?business_id=
   * Returns current agent settings (API key is masked to boolean).
   */
  getSettings: async (req, res) => {
    try {
      const { business_id } = req.query;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'business_id is required' });
      }
      const data = await agentService.getSettings(Number(business_id));
      return res.status(200).json({ success: true, data });
    } catch (err) {
      console.error('[agentController.getSettings]', err.message);
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  2. SAVE SETTINGS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/agent/settings
   * Body: { business_id, openrouter_api_key?, model?, system_prompt? }
   */
  saveSettings: async (req, res) => {
    try {
      const { business_id, openrouter_api_key, model, system_prompt } = req.body;
      if (!business_id) {
        return res.status(400).json({ success: false, message: 'business_id is required' });
      }
      const data = await agentService.saveSettings(Number(business_id), {
        openrouter_api_key,
        model,
        system_prompt,
      });
      return res.status(200).json({ success: true, message: 'Agent settings saved successfully', data });
    } catch (err) {
      console.error('[agentController.saveSettings]', err.message);
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  3. VERIFY API KEY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/agent/verify-key
   * Body: { api_key }
   * Pings OpenRouter to check if the key works (does NOT save it).
   */
  verifyApiKey: async (req, res) => {
    try {
      const { api_key } = req.body;
      if (!api_key) {
        return res.status(400).json({ success: false, message: 'api_key is required' });
      }
      const result = await agentService.verifyApiKey(api_key);
      return res.status(result.valid ? 200 : 400).json({
        success: result.valid,
        message: result.valid ? 'API key is valid' : 'API key verification failed',
        ...result,
      });
    } catch (err) {
      console.error('[agentController.verifyApiKey]', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  4. CHAT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/agent/chat
   * Body: { business_id, prompt, history? }
   * Sends a message to the configured OpenRouter model and returns the reply.
   */
  chat: async (req, res) => {
    try {
      const { business_id, prompt, history = [] } = req.body;

      const missing = [];
      if (!business_id) missing.push('business_id is required');
      if (!prompt)      missing.push('prompt is required');

      if (missing.length) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: missing });
      }

      const result = await agentService.chat(Number(business_id), prompt, history);
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      console.error('[agentController.chat]', err.message);
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.apiError && { apiError: err.apiError }),
      });
    }
  },

};
