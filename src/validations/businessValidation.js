const Joi = require('joi');

// ─── Business ────────────────────────────────────────────────────────────────

const businessCreateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  created_by: Joi.number().integer().positive().optional(),
  is_active: Joi.boolean().optional(),
  address: Joi.string().trim().allow('', null).optional(),
});

const businessUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  is_active: Joi.boolean().optional(),
  address: Joi.string().trim().allow('', null).optional(),
}).min(1);

// ─── Social Number ──────────────────────────────────────────────────────────

// Stored in a STRING(20) column: optional leading '+' followed by 7–19 digits.
const phoneNumber = Joi.string()
  .trim()
  .pattern(/^\+?[0-9]{7,19}$/)
  .max(20)
  .messages({
    'string.pattern.base': '"phone_number" must be 7-19 digits with an optional leading +',
  });

const socialNumberCreateSchema = Joi.object({
  business_id: Joi.number().integer().positive().required(),
  phone_number: phoneNumber.required(),
  is_activated: Joi.boolean().optional(),
});

const socialNumberUpdateSchema = Joi.object({
  business_id: Joi.number().integer().positive().optional(),
  phone_number: phoneNumber.optional(),
  is_activated: Joi.boolean().optional(),
}).min(1);

// ─── Business Social ─────────────────────────────────────────────────────────

const businessSocialCreateSchema = Joi.object({
  business_id: Joi.number().integer().positive().required(),
  type: Joi.string().valid('tiktok', 'instagram', 'whatsapp', 'facebook').required(),
  // The business's own number for this social account.
  phone: phoneNumber.allow(null, '').optional(),
  is_activated: Joi.boolean().optional(),
});

const businessSocialUpdateSchema = Joi.object({
  business_id: Joi.number().integer().positive().optional(),
  type: Joi.string().valid('tiktok', 'instagram', 'whatsapp', 'facebook').optional(),
  phone: phoneNumber.allow(null, '').optional(),
  is_activated: Joi.boolean().optional(),
}).min(1);

// ─── Sync / Unsync ───────────────────────────────────────────────────────────

// Accepts a list of ids, or a single id for backwards compatibility.
const socialNumberIds = Joi.alternatives().try(
  Joi.array().items(Joi.number().integer().positive()).min(1).unique(),
  Joi.number().integer().positive().custom(v => [v]),
);

const syncSocialNumberSchema = Joi.object({
  social_number_ids: socialNumberIds,
  social_number_id: Joi.number().integer().positive(),
})
  .or('social_number_ids', 'social_number_id')
  .nand('social_number_ids', 'social_number_id');

// Unsync with no body removes every synced number.
const unsyncSocialNumberSchema = Joi.object({
  social_number_ids: socialNumberIds.optional(),
  social_number_id: Joi.number().integer().positive().optional(),
}).nand('social_number_ids', 'social_number_id');

module.exports = {
  businessCreateSchema,
  businessUpdateSchema,
  socialNumberCreateSchema,
  socialNumberUpdateSchema,
  businessSocialCreateSchema,
  businessSocialUpdateSchema,
  syncSocialNumberSchema,
  unsyncSocialNumberSchema,
};
