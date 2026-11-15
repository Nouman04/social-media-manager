'use strict';

const { Subscription, SubscriptionRequest, SubscriptionHistory, Plan, PlanFeature, Business, User, sequelize } = require('../../models');
const subscriptions = require('../services/subscriptionService');
const {
  subscriptionCreateSchema,
  subscriptionUpdateSchema,
} = require('../validations/planValidation');
const { syncStripeSubscription } = require('../services/stripeSubscriptionSync');
const stripe = process.env.STRIPE_SECRET ? require('stripe')(process.env.STRIPE_SECRET) : null;

// Business (with owner) + plan (with features). The change log is in /admin/businesses/:uuid/subscription-history.
const listInclude = [
  {
    model: Business, as: 'business', attributes: ['id', 'uuid', 'name', 'is_active'],
    include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
  },
  {
    model: Plan, as: 'plan', attributes: { exclude: ['stripe_product_id', 'stripe_price_id'] },
    include: [{ model: PlanFeature, as: 'features', attributes: ['id', 'feature_name', 'feature_value'] }],
  },
];

/**
 * Billing is manual: hide the Stripe-named columns. `status` is the real lifecycle column.
 * Plans are addressed by uuid, so the numeric plan_id becomes plan_uuid.
 */
const toPublic = (sub) => {
  if (!sub) return sub;
  const { stripe_subscription_id, stripe_status, plan_id, ...rest } = sub.toJSON();
  return { ...rest, plan_uuid: rest.plan?.uuid ?? null };
};

const STATUS_FILTER = new Set(subscriptions.STATUSES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badUuid = (res) =>
  res.status(400).json({ success: false, message: 'Validation failed', details: ['uuid must be a valid UUID'] });
// uuids are stored lowercase and the column compares case-sensitively.
const uuidWhere = (uuid) => ({ uuid: uuid.toLowerCase() });
const planBrief = ['id', 'uuid', 'name', 'price', 'currency', 'interval'];

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

      // uuids are stored lowercase and the column compares case-sensitively.
      const business = await Business.findOne({ where: { uuid: value.business_uuid.toLowerCase() }, attributes: ['id'] });
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }

      // uuids are stored lowercase and the column compares case-sensitively.
      const plan = await Plan.findOne({ where: { uuid: value.plan_uuid.toLowerCase() }, attributes: ['id'] });
      if (!plan) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      // One row per business: create it, or set the existing one (both recorded in the history).
      const { plan_uuid, business_uuid, ...fields } = value;
      const business_id = business.id;
      const data = {
        ...fields,
        plan_id: plan.id,
        ...(fields.status === 'cancelled' && { canceled_at: new Date() }),
      };
      const { subscription, created } = await sequelize.transaction(async (transaction) => {
        const existing = await subscriptions.getForBusiness(business_id, { lock: transaction.LOCK.UPDATE, transaction });
        const ctx = { actorId: req.user?.id || null, details: { set_by: 'admin', ...fields }, transaction };
        if (existing) {
          await subscriptions.transition(existing, data, { ...ctx, action: 'updated' });
          return { subscription: existing, created: false };
        }
        return { subscription: await subscriptions.createForBusiness(business_id, data, { ...ctx, action: 'created' }), created: true };
      });

      const full = await Subscription.findByPk(subscription.id, { include: listInclude });

      return res.status(created ? 201 : 200).json({
        success: true,
        message: created ? 'Subscription created successfully' : 'Business already had a subscription; it was updated',
        subscription: toPublic(full),
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
      const { business_uuid, status } = req.query;
      if (req.query.business_id !== undefined) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_id is not accepted; filter by business_uuid'] });
      }
      // An unresolved Postman variable ("{{businessUuid}}") or any non-uuid must not silently return an empty list.
      if (business_uuid && !UUID_RE.test(business_uuid)) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['business_uuid must be a valid UUID (is the {{businessUuid}} variable set?)'] });
      }
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

      const where = {};
      if (business_uuid) {
        const business = await Business.findOne({ where: uuidWhere(business_uuid), attributes: ['id'] });
        if (!business) return res.status(404).json({ success: false, message: 'Business not found' });
        where.business_id = business.id;
      }
      if (status && status !== 'all') {
        const list = String(status).split(',').map((s) => s.trim());
        if (list.some((s) => !STATUS_FILTER.has(s))) {
          return res.status(400).json({ success: false, message: 'Validation failed', details: [`status must be one of ${subscriptions.STATUSES.join(', ')}, all`] });
        }
        where.status = list;
      }

      const { count, rows } = await Subscription.findAndCountAll({
        where,
        include: listInclude,
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset: (page - 1) * limit,
        distinct: true,
      });

      return res.status(200).json({
        success: true,
        // The plan's uuid is already inside `plan`, so the list drops the top-level plan_uuid.
        subscriptions: rows.map((row) => { const { plan_uuid, ...sub } = toPublic(row); return sub; }),
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
      if (!UUID_RE.test(req.params.uuid)) return badUuid(res);
      const subscription = await Subscription.findOne({ where: uuidWhere(req.params.uuid), include: listInclude });

      if (!subscription) {
        return res.status(404).json({ success: false, message: 'Subscription not found' });
      }

      return res.status(200).json({ success: true, subscription: toPublic(subscription) });
    } catch (err) {
      console.error('[subscriptionController.getSubscriptionById] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  UPDATE SUBSCRIPTION
  // ══════════════════════════════════════════════════════════════════════════

  // PUT /subscriptions/:uuid
  updateSubscription: async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.uuid)) return badUuid(res);
      const { error, value } = subscriptionUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const subscription = await Subscription.findOne({ where: uuidWhere(req.params.uuid) });
      if (!subscription) {
        return res.status(404).json({ success: false, message: 'Subscription not found' });
      }

      const { plan_uuid, ...changes } = value;
      if (plan_uuid) {
        // uuids are stored lowercase and the column compares case-sensitively.
        const plan = await Plan.findOne({ where: { uuid: plan_uuid.toLowerCase() }, attributes: ['id'] });
        if (!plan) {
          return res.status(404).json({ success: false, message: 'Plan not found' });
        }
        changes.plan_id = plan.id;
      }

      if (changes.status === 'cancelled' && changes.canceled_at === undefined) changes.canceled_at = new Date();
      await sequelize.transaction((transaction) => subscriptions.transition(subscription, changes, {
        action: 'updated', actorId: req.user?.id || null, details: value, transaction,
      }));

      const updated = await Subscription.findByPk(subscription.id, { include: listInclude });

      return res.status(200).json({
        success: true,
        message: 'Subscription updated successfully',
        subscription: toPublic(updated),
      });
    } catch (err) {
      console.error('[subscriptionController.updateSubscription] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CANCEL SUBSCRIPTION
  // ══════════════════════════════════════════════════════════════════════════

  // PATCH /subscriptions/:uuid/cancel
  cancelSubscription: async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.uuid)) return badUuid(res);
      const subscription = await Subscription.findOne({ where: uuidWhere(req.params.uuid) });
      if (!subscription) {
        return res.status(404).json({ success: false, message: 'Subscription not found' });
      }

      // Only a running or waiting subscription can be cancelled.
      if (!['active', 'pending'].includes(subscription.status)) {
        return res.status(409).json({ success: false, message: `Subscription is already ${subscription.status}` });
      }

      const wasPending = subscription.status === 'pending';
      await sequelize.transaction(async (transaction) => {
        const now = new Date();
        // A pending subscription's request is cancelled with it.
        const pendingRequest = wasPending
          ? await SubscriptionRequest.findOne({ where: { subscription_id: subscription.id, status: 'pending' }, transaction })
          : null;
        if (pendingRequest) await pendingRequest.update({ status: 'cancelled' }, { transaction });
        // Cancelling ends access now (manual billing has no paid-through period).
        await subscriptions.transition(subscription, { status: 'cancelled', canceled_at: now, ends_at: now }, {
          action: 'cancelled', actorId: req.user?.id || null, requestId: pendingRequest?.id || null, transaction,
        });
      });

      const cancelled = await Subscription.findByPk(subscription.id, { include: listInclude });

      return res.status(200).json({
        success: true,
        message: 'Subscription cancelled successfully',
        subscription: toPublic(cancelled),
      });
    } catch (err) {
      console.error('[subscriptionController.cancelSubscription] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SUBSCRIPTION HISTORY OF A BUSINESS (Super Admin)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /admin/businesses/:uuid/subscription-history?limit=&offset=
   * The business, its current subscription row, any pending request, and every
   * recorded change newest first: who did it, when, from → to status, plan.
   */
  getBusinessSubscriptionHistory: async (req, res) => {
    try {
      const { uuid } = req.params;
      if (!UUID_RE.test(uuid)) {
        return res.status(400).json({ success: false, message: 'Validation failed', details: ['uuid must be a valid UUID'] });
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      // uuids are stored lowercase and the column compares case-sensitively.
      const business = await Business.findOne({
        where: { uuid: uuid.toLowerCase() },
        attributes: ['id', 'uuid', 'name', 'is_active', 'created_at'],
        include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      });
      if (!business) return res.status(404).json({ success: false, message: 'Business not found' });

      const [current, pendingRequest, { count, rows }] = await Promise.all([
        subscriptions.getForBusiness(business.id, {
          include: [{ model: Plan, as: 'plan', attributes: planBrief }],
        }),
        SubscriptionRequest.findOne({
          where: { business_id: business.id, status: 'pending' },
          include: [{ model: Plan, as: 'plan', attributes: planBrief }, { model: User, as: 'requester', attributes: ['id', 'name', 'email'] }],
        }),
        SubscriptionHistory.findAndCountAll({
          where: { business_id: business.id },
          include: [
            { model: User, as: 'actor', attributes: ['id', 'name', 'email'] },
            { model: Plan, as: 'plan', attributes: planBrief },
            { model: Plan, as: 'previous_plan', attributes: planBrief },
            {
              model: SubscriptionRequest, as: 'request',
              attributes: ['id', 'type', 'status', 'note', 'payment_reference', 'receipt_url', 'admin_note', 'reject_reason'],
            },
          ],
          // By time: backfilled entries were inserted out of order; id breaks ties.
          order: [['created_at', 'DESC'], ['id', 'DESC']],
          limit,
          offset,
        }),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          business,
          subscription: current ? toPublic(current) : null,
          pending_request: pendingRequest || null,
          history: rows.map((h) => {
            const { plan_id, previous_plan_id, actor_id, subscription_request_id, ...rest } = h.toJSON();
            // actor null = done by the system (e.g. the expiry job).
            return { ...rest, actor: rest.actor || { type: 'system' } };
          }),
        },
        total: count,
      });
    } catch (err) {
      console.error('[subscriptionController.getBusinessSubscriptionHistory] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  GET ACTIVE SUBSCRIPTION FOR A BUSINESS
  // ══════════════════════════════════════════════════════════════════════════

  // GET /subscriptions/business/:businessUuid
  getBusinessSubscription: async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.businessUuid)) return badUuid(res);

      const business = await Business.findOne({ where: uuidWhere(req.params.businessUuid), attributes: ['id'] });
      if (!business) {
        return res.status(404).json({ success: false, message: 'Business not found' });
      }
      const businessId = business.id;

      // The business's single subscription row; `status` says where it stands.
      const subscription = await subscriptions.getForBusiness(businessId, { include: listInclude });

      const pending_request = await SubscriptionRequest.findOne({
        where: { business_id: businessId, status: 'pending' },
        include: [{ model: Plan, as: 'plan', attributes: ['id', 'uuid', 'name', 'price', 'currency', 'interval'] }],
        order: [['created_at', 'DESC']],
      });

      return res.status(200).json({
        success: true,
        subscription: subscription ? toPublic(subscription) : null,
        pending_request: pending_request || null,
      });
    } catch (err) {
      console.error('[subscriptionController.getBusinessSubscription] Error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  },
};
