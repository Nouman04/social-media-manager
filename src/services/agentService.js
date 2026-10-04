'use strict';

const axios = require('axios');
const { AgentSetting } = require('../../models');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// ─── Available models for the UI dropdown ────────────────────────────────────
const AVAILABLE_MODELS = [
  { id: 'deepseek/deepseek-chat',           label: 'DeepSeek Chat' },
  { id: 'openai/gpt-4o',                    label: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini',               label: 'GPT-4o Mini' },
  { id: 'anthropic/claude-3.5-sonnet',      label: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3-haiku',         label: 'Claude 3 Haiku' },
  { id: 'google/gemini-2.5-flash',          label: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-pro',                label: 'Gemini Pro' },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B' },
  { id: 'mistralai/mistral-7b-instruct',    label: 'Mistral 7B' },
];

/**
 * Fetch (or create) agent settings for a business.
 * @param {number} businessId
 * @returns {Promise<AgentSetting>}
 */
const getOrCreate = async (businessId) => {
  const [setting] = await AgentSetting.findOrCreate({
    where: { business_id: businessId },
    defaults: {
      business_id: businessId,
      model: 'deepseek/deepseek-chat',
    },
  });
  return setting;
};

/**
 * Return the current settings for a business (public-safe — key is masked).
 * @param {number} businessId
 */
const getSettings = async (businessId) => {
  const setting = await getOrCreate(businessId);
  return {
    business_id:    setting.business_id,
    model:          setting.model,
    system_prompt:  setting.system_prompt,
    has_api_key:    !!setting.openrouter_api_key,
    available_models: AVAILABLE_MODELS,
  };
};

/**
 * Save / update settings for a business.
 * @param {number} businessId
 * @param {{ openrouter_api_key?, model?, system_prompt? }} data
 */
const saveSettings = async (businessId, data) => {
  const setting = await getOrCreate(businessId);

  const updates = {};
  if (data.openrouter_api_key !== undefined) updates.openrouter_api_key = data.openrouter_api_key;
  if (data.model              !== undefined) updates.model              = data.model;
  if (data.system_prompt      !== undefined) updates.system_prompt      = data.system_prompt;

  await setting.update(updates);

  return getSettings(businessId);
};

/**
 * Verify that the supplied OpenRouter API key is functional by hitting the
 * /models endpoint (light, no usage charge).
 * @param {string} apiKey
 */
const verifyApiKey = async (apiKey) => {
  try {
    const res = await axios.get(`${OPENROUTER_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 8000,
    });
    return { valid: true, model_count: res.data?.data?.length || 0 };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { valid: false, error: msg };
  }
};

/**
 * Run a chat completion via OpenRouter using the business agent settings.
 *
 * @param {number}   businessId
 * @param {string}   userPrompt
 * @param {Array}    history    - Previous messages: [{role, content}, ...]
 */
const chat = async (businessId, userPrompt, history = []) => {
  const setting = await getOrCreate(businessId);

  if (!setting.openrouter_api_key) {
    const err = new Error('OpenRouter API key is not configured for this business. Please add it in Agent Settings.');
    err.statusCode = 400;
    throw err;
  }

  // Build message array: optional system prompt + history + new user message
  const messages = [];
  if (setting.system_prompt) {
    messages.push({ role: 'system', content: setting.system_prompt });
  }
  messages.push(...history);
  messages.push({ role: 'user', content: userPrompt });

  try {
    const response = await axios.post(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        model:       setting.model || 'deepseek/deepseek-chat',
        messages,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization:  `Bearer ${setting.openrouter_api_key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':  process.env.APP_URL || 'https://smm.app',
          'X-Title':       'SMM Agent',
        },
        timeout: 60000,
      }
    );

    const data = response.data;
    return {
      success:    true,
      provider:   'OpenRouter',
      model_used: data.model,
      text:       data.choices[0].message.content,
      usage:      data.usage,
    };
  } catch (err) {
    const apiErr = err.response?.data?.error;
    const error  = new Error(apiErr?.message || err.message);
    error.statusCode = err.response?.status || 500;
    if (apiErr) error.apiError = apiErr;
    throw error;
  }
};

module.exports = {
  getSettings,
  saveSettings,
  verifyApiKey,
  chat,
  AVAILABLE_MODELS,
};
