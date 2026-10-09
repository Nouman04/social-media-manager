'use strict';

const { Subscription, Plan, PlanFeature, Business, sequelize } = require('../../models');
const {
  subscriptionCreateSchema,
  subscriptionUpdateSchema,
} = require('../validations/planValidation');
const { syncStripeSubscription } = require('../services/stripeSubscriptionSync');
const stripe = process.env.STRIPE_SECRET ? require('stripe')(process.env.STRIPE_SECRET) : null;

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  CREATE STRIPE CHECKOUT SESSION
  // ══════════════════════════════════════════════════════════════════════════

  createCheckoutSession: async (req, res) => {
    try {
      const { plan_id, business_id } = req.body;

      if (!plan_id || !business_id) {
        return res.status(400).json({ success: false, message: 'plan_id and business_id are required' });
      }

      const business = await Business.findByPk(business_id);
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      const plan = await Plan.findByPk(plan_id);
      if (!plan) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      if (!plan.stripe_price_id) {
        return res.status(400).json({ success: false, message: 'Selected plan is not configured for Stripe billing' });
      }

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price: plan.stripe_price_id,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${process.env.APP_URL || 'http://localhost:5000'}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL || 'http://localhost:5000'}/pricing`,
        metadata: {
          business_id: business.id.toString(),
          plan_id: plan.id.toString()
        },
        subscription_data: {
          metadata: { business_id: business.id.toString(), plan_id: plan.id.toString() },
          ...(plan.trial_days > 0 ? { trial_period_days: plan.trial_days } : {}),
        },
      });

      return res.status(200).json({
        success: true,
        checkout_url: session.url,
        session_id: session.id,
      });
    } catch (err) {
      console.error('[subscriptionController.createCheckoutSession] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CHECKOUT SUCCESS CALLBACK — verifies the session with Stripe and syncs
  //  the subscription, so it works even if the webhook hasn't arrived yet.
  // ══════════════════════════════════════════════════════════════════════════

  confirmCheckout: async (req, res) => {
    try {
      const { session_id } = req.query;
      if (!session_id) {
        return res.status(400).json({ success: false, message: 'session_id is required' });
      }

      const session = await stripe.checkout.sessions.retrieve(session_id);
      const meta = session.metadata || {};
      if (session.mode !== 'subscription' || !session.subscription || !meta.business_id || !meta.plan_id) {
        return res.status(400).json({ success: false, message: 'Not a valid subscription checkout session' });
      }
      if (session.status !== 'complete') {
        return res.status(400).json({ success: false, message: 'Checkout not completed' });
      }

      const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
      const sub = await syncStripeSubscription(stripeSub, {
        business_id: meta.business_id,
        plan_id: meta.plan_id,
      });

      const subscription = await Subscription.findByPk(sub.id, {
        include: [{ model: Plan, as: 'plan', attributes: ['id', 'name', 'price', 'currency', 'interval'] }],
      });

      return res.status(200).json({ success: true, subscription });
    } catch (err) {
      console.error('[subscriptionController.confirmCheckout] Error:', err);
      return res.status(500).json({ success: false, message: 'Could not confirm checkout', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CREATE SUBSCRIPTION (MANUAL)
  // ══════════════════════════════════════════════════════════════════════════

  createSubscription: async (req, res) => {
    try {
      const { error, value } = subscriptionCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const business = await Business.findByPk(value.business_id);
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      const plan = await Plan.findByPk(value.plan_id);
      if (!plan) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      const subscription = await Subscription.create(value);

      const created = await Subscription.findByPk(subscription.id, {
        include: [
          { model: Business, as: 'business', attributes: ['id', 'name'] },
          {
            model: Plan, as: 'plan',
            include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
          },
        ],
      });

      return res.status(201).json({
        success: true,
        message: 'Subscription created successfully',
        subscription: created,
      });
    } catch (err) {
      console.error('[subscriptionController.createSubscription] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  LIST SUBSCRIPTIONS
  // ══════════════════════════════════════════════════════════════════════════

  getSubscriptions: async (req, res) => {
    try {
      const { business_id, stripe_status } = req.query;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

      const where = {};
      if (business_id) where.business_id = business_id;
      if (stripe_status) where.stripe_status = stripe_status;

      const { count, rows } = await Subscription.findAndCountAll({
        where,
        include: [
          { model: Business, as: 'business', attributes: ['id', 'name'] },
          {
            model: Plan, as: 'plan',
            include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
          },
        ],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset: (page - 1) * limit,
        distinct: true,
      });

      return res.status(200).json({
        success: true,
        subscriptions: rows,
        pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      console.error('[subscriptionController.getSubscriptions] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  GET SUBSCRIPTION BY ID
  // ══════════════════════════════════════════════════════════════════════════

  getSubscriptionById: async (req, res) => {
    try {
      const subscription = await Subscription.findByPk(req.params.id, {
        include: [
          { model: Business, as: 'business', attributes: ['id', 'name'] },
          {
            model: Plan, as: 'plan',
            include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
          },
        ],
      });

      if (!subscription) {
        return res.status(404).json({ success: false, message: 'Subscription not found' });
      }

      return res.status(200).json({ success: true, subscription });
    } catch (err) {
      console.error('[subscriptionController.getSubscriptionById] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  UPDATE SUBSCRIPTION
  // ══════════════════════════════════════════════════════════════════════════

  updateSubscription: async (req, res) => {
    try {
      const { error, value } = subscriptionUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const subscription = await Subscription.findByPk(req.params.id);
      if (!subscription) {
        return res.status(404).json({ success: false, message: 'Subscription not found' });
      }

      if (value.plan_id) {
        const plan = await Plan.findByPk(value.plan_id);
        if (!plan) {
          return res.status(404).json({ success: false, message: 'Plan not found' });
        }
      }

      await subscription.update(value);

      const updated = await Subscription.findByPk(subscription.id, {
        include: [
          { model: Business, as: 'business', attributes: ['id', 'name'] },
          {
            model: Plan, as: 'plan',
            include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
          },
        ],
      });

      return res.status(200).json({
        success: true,
        message: 'Subscription updated successfully',
        subscription: updated,
      });
    } catch (err) {
      console.error('[subscriptionController.updateSubscription] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CANCEL SUBSCRIPTION
  // ══════════════════════════════════════════════════════════════════════════

  cancelSubscription: async (req, res) => {
    try {
      const subscription = await Subscription.findByPk(req.params.id);
      if (!subscription) {
        return res.status(404).json({ success: false, message: 'Subscription not found' });
      }

      if (subscription.stripe_status === 'canceled') {
        return res.status(400).json({ success: false, message: 'Subscription is already canceled' });
      }

      await subscription.update({
        stripe_status: 'canceled',
        canceled_at: new Date(),
        ends_at: subscription.current_period_end || new Date(),
      });

      return res.status(200).json({
        success: true,
        message: 'Subscription canceled successfully',
        subscription,
      });
    } catch (err) {
      console.error('[subscriptionController.cancelSubscription] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  GET ACTIVE SUBSCRIPTION FOR A BUSINESS
  // ══════════════════════════════════════════════════════════════════════════

  getBusinessSubscription: async (req, res) => {
    try {
      const { businessId } = req.params;

      const business = await Business.findByPk(businessId);
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      const subscription = await Subscription.findOne({
        where: {
          business_id: businessId,
          stripe_status: ['trialing', 'active'],
        },
        include: [
          {
            model: Plan, as: 'plan',
            include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
          },
        ],
        order: [['created_at', 'DESC']],
      });

      return res.status(200).json({
        success: true,
        subscription: subscription || null,
      });
    } catch (err) {
      console.error('[subscriptionController.getBusinessSubscription] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },
};
