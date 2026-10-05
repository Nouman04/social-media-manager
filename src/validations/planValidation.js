'use strict';

const Joi = require('joi');

// ─── Plan ────────────────────────────────────────────────────────────────────

const planCreateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().allow('', null).optional(),
  stripe_product_id: Joi.string().trim().max(255).allow('', null).optional(),
  stripe_price_id: Joi.string().trim().max(255).allow('', null).optional(),
  price: Joi.number().min(0).precision(2).required(),
  currency: Joi.string().trim().length(3).lowercase().default('usd'),
  interval: Joi.string().valid('month', 'year').default('month'),
  trial_days: Joi.number().integer().min(0).default(0),
  is_active: Joi.boolean().default(true),
  sort_order: Joi.number().integer().min(0).default(0),
  features: Joi.array().items(
    Joi.object({
      feature_name: Joi.string().trim().min(1).max(100).required(),
      feature_value: Joi.string().trim().min(1).max(255).required(),
    })
  ).optional(),
});

const planUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional(),
  description: Joi.string().trim().allow('', null).optional(),
  stripe_product_id: Joi.string().trim().max(255).allow('', null).optional(),
  stripe_price_id: Joi.string().trim().max(255).allow('', null).optional(),
  price: Joi.number().min(0).precision(2).optional(),
  currency: Joi.string().trim().length(3).lowercase().optional(),
  interval: Joi.string().valid('month', 'year').optional(),
  trial_days: Joi.number().integer().min(0).optional(),
  is_active: Joi.boolean().optional(),
  sort_order: Joi.number().integer().min(0).optional(),
  features: Joi.array().items(
    Joi.object({
      feature_name: Joi.string().trim().min(1).max(100).required(),
      feature_value: Joi.string().trim().min(1).max(255).required(),
    })
  ).optional(),
}).min(1);

// ─── Subscription ────────────────────────────────────────────────────────────

const subscriptionCreateSchema = Joi.object({
  business_id: Joi.number().integer().positive().required(),
  plan_id: Joi.number().integer().positive().required(),
  stripe_subscription_id: Joi.string().trim().max(255).required(),
  stripe_status: Joi.string().trim().max(50).default('incomplete'),
  trial_ends_at: Joi.date().allow(null).optional(),
  current_period_start: Joi.date().allow(null).optional(),
  current_period_end: Joi.date().allow(null).optional(),
  ends_at: Joi.date().allow(null).optional(),
});

const subscriptionUpdateSchema = Joi.object({
  plan_id: Joi.number().integer().positive().optional(),
  stripe_status: Joi.string().trim().max(50).optional(),
  trial_ends_at: Joi.date().allow(null).optional(),
  current_period_start: Joi.date().allow(null).optional(),
  current_period_end: Joi.date().allow(null).optional(),
  ends_at: Joi.date().allow(null).optional(),
  canceled_at: Joi.date().allow(null).optional(),
}).min(1);

module.exports = {
  planCreateSchema,
  planUpdateSchema,
  subscriptionCreateSchema,
  subscriptionUpdateSchema,
};
