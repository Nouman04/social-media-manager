const Joi = require('joi');

// ─── Social Number ──────────────────────────────────────────────────────────

const socialNumberCreateSchema = Joi.object({
  business_id: Joi.number().integer().positive().required(),
  is_activated: Joi.boolean().optional(),
});

const socialNumberUpdateSchema = Joi.object({
  business_id: Joi.number().integer().positive().optional(),
  is_activated: Joi.boolean().optional(),
}).min(1);

// ─── Business Social ─────────────────────────────────────────────────────────

const businessSocialCreateSchema = Joi.object({
  business_id: Joi.number().integer().positive().required(),
  type: Joi.string().valid('tiktok', 'instagram', 'whatsapp', 'facebook').required(),
  business_number: Joi.number().integer().positive().allow(null).optional(),
  is_activated: Joi.boolean().optional(),
});

const businessSocialUpdateSchema = Joi.object({
  business_id: Joi.number().integer().positive().optional(),
  type: Joi.string().valid('tiktok', 'instagram', 'whatsapp', 'facebook').optional(),
  business_number: Joi.number().integer().positive().allow(null).optional(),
  is_activated: Joi.boolean().optional(),
}).min(1);

// ─── Sync / Unsync ───────────────────────────────────────────────────────────

const syncSocialNumberSchema = Joi.object({
  social_number_id: Joi.number().integer().positive().required(),
});

module.exports = {
  socialNumberCreateSchema,
  socialNumberUpdateSchema,
  businessSocialCreateSchema,
  businessSocialUpdateSchema,
  syncSocialNumberSchema,
};
