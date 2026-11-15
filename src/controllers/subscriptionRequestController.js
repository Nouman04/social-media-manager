'use strict';

const { Op } = require('sequelize');
const Joi = require('joi');
const {
  SubscriptionRequest, Subscription, Plan, Business, User, Role, sequelize,
} = require('../../models');
const { sendNotificationEmail } = require('../helpers/mailService');
const realtime = require('../helpers/realtime');
const subscriptions = require('../services/subscriptionService');

// The subscription row a request owns (created as `pending` with the request).
const subscriptionInclude = {
  model: Subscription, as: 'subscription',
  attributes: { exclude: ['stripe_subscription_id', 'stripe_status'] },
};

const createSchema = Joi.object({
  business_id: Joi.number().integer().positive().required(),
  // Plans are addressed by their public uuid (same as GET/PUT/DELETE /plans/:uuid).
  plan_uuid: Joi.string().trim().guid().required(),
  note: Joi.string().trim().max(2000).allow('', null),
  payment_reference: Joi.string().trim().max(255).allow('', null),
});

const approveSchema = Joi.object({
  starts_at: Joi.date().iso().allow(null),
  ends_at: Joi.date().iso().allow(null),
  admin_note: Joi.string().trim().max(2000).allow('', null),
});

const rejectSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(2000).required(),
});

const fail = (res, status, message, details) =>
  res.status(status).json({ success: false, message, ...(details && { details }) });

const validationFail = (res, error) =>
  fail(res, 400, 'Validation failed', error.details.map(d => d.message));

const fullInclude = [
  { model: Business, as: 'business', attributes: ['id', 'name'] },
  { model: User, as: 'requester', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'reviewer', attributes: ['id', 'name', 'email'] },
  { model: Plan, as: 'plan', attributes: ['id', 'uuid', 'name', 'price', 'currency', 'interval'] },
];

/** ends_at default: starts_at + one plan interval (month | year). */
const addInterval = (start, interval) => {
  const end = new Date(start);
  if (interval === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
};

/** Fire-and-forget: notify the requester by email + socket to the business room. */
const notifyRequester = async (request, event, subject, text) => {
  realtime.emitToBusiness(request.business_id, event, { id: request.id, status: request.status });
  const requester = request.requester || (request.requested_by && await User.findByPk(request.requested_by, { attributes: ['email'] }));
  if (requester?.email) sendNotificationEmail(requester.email, subject, text);
};

/**
 * A request was closed without approval (rejected / cancelled). A business that
 * was only waiting on it (status pending) moves to `toStatus`; a business with
 * an active plan keeps it and only gets a history entry.
 */
const closeRequestOnSubscription = async (request, { action, toStatus, actorId, details, transaction }) => {
  const sub = request.subscription_id
    ? await Subscription.findByPk(request.subscription_id, { lock: transaction.LOCK.UPDATE, transaction })
    : null;
  const ctx = { action, actorId, requestId: request.id, details, transaction };
  if (sub && sub.status === 'pending') {
    return subscriptions.transition(sub, { status: toStatus, ...(toStatus === 'cancelled' && { canceled_at: new Date() }) }, ctx);
  }
  return subscriptions.log({
    ...ctx, businessId: request.business_id, subscriptionId: sub?.id, from: sub?.status ?? null, to: sub?.status ?? null, planId: request.plan_id,
  });
};

const notifySuperAdmins = async (subject, text) => {
  const admins = await User.findAll({
    attributes: ['email'],
    include: [{ model: Role, as: 'roles', where: { name: 'super_admin' }, attributes: [], through: { attributes: [] } }],
  });
  admins.forEach(a => a.email && sendNotificationEmail(a.email, subject, text));
};

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  CRM (business user)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /subscriptions/requests — JSON or multipart (optional `receipt` file).
   * A business has one pending request: if one exists it is updated with this
   * request's plan and details (200), otherwise a new one is created (201).
   */
  createRequest: async (req, res) => {
    try {
      const { error, value } = createSchema.validate(req.body, { abortEarly: false });
      if (error) return validationFail(res, error);

      // uuids are stored lowercase and the column compares case-sensitively.
      const plan = await Plan.findOne({ where: { uuid: value.plan_uuid.toLowerCase() } });
      if (!plan || !plan.is_active) return fail(res, 404, 'Plan not found or not active');

      const active = await subscriptions.findCurrent(req.businessId, { attributes: ['id'] });
      const receiptUrl = req.file ? `/public/uploads/receipts/${req.file.filename}` : null;

      const { request, updated } = await sequelize.transaction(async (transaction) => {
        // Lock the pending request so an admin approve/reject can't interleave with this update.
        const pending = await SubscriptionRequest.findOne({
          where: { business_id: req.businessId, status: 'pending' },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });

        // The business's single subscription row (locked: approve/reject change it too).
        let sub = await subscriptions.getForBusiness(req.businessId, { lock: transaction.LOCK.UPDATE, transaction });
        const details = {
          note: value.note ?? null,
          payment_reference: value.payment_reference ?? null,
          receipt_url: receiptUrl,
        };

        if (pending) {
          const previousPlanId = pending.plan_id;
          // Fields not sent keep their old value; a new receipt replaces the old one.
          await pending.update({
            requested_by: req.user.id,
            plan_id: plan.id,
            type: active ? 'change' : 'new',
            ...(value.note !== undefined && { note: value.note || null }),
            ...(value.payment_reference !== undefined && { payment_reference: value.payment_reference || null }),
            ...(receiptUrl && { receipt_url: receiptUrl }),
          }, { transaction });
          const ctx = { action: 'request_updated', actorId: req.user.id, requestId: pending.id, details, transaction };
          if (sub && sub.status === 'pending') {
            await subscriptions.transition(sub, { plan_id: plan.id }, ctx);
          } else {
            // An upgrade requested while a plan is active: status stays, the request changed.
            await subscriptions.log({
              ...ctx, businessId: req.businessId, subscriptionId: sub?.id, from: sub?.status, to: sub?.status,
              planId: plan.id, previousPlanId: previousPlanId !== plan.id ? previousPlanId : null,
            });
          }
          return { request: pending, updated: true };
        }

        // shortcut: two first-time requests at the same instant can both insert; the unique index on
        // subscriptions.business_id makes the loser fail with 500 — retry is safe.
        const ctx = { action: 'requested', actorId: req.user.id, details: { ...details, type: active ? 'change' : 'new' }, transaction };
        const request = await SubscriptionRequest.create({
          business_id: req.businessId,
          requested_by: req.user.id,
          plan_id: plan.id,
          type: active ? 'change' : 'new',
          status: 'pending',
          note: value.note || null,
          payment_reference: value.payment_reference || null,
          receipt_url: receiptUrl,
        }, { transaction });
        ctx.requestId = request.id;

        if (!sub) {
          sub = await subscriptions.createForBusiness(req.businessId, { plan_id: plan.id, status: 'pending' }, ctx);
        } else if (sub.status !== 'active') {
          // No running plan: the business is now waiting for approval.
          await subscriptions.transition(sub, { ...subscriptions.NO_PERIOD, status: 'pending', plan_id: plan.id }, ctx);
        } else {
          // Plan is active: it keeps running until the change is approved.
          await subscriptions.log({ ...ctx, businessId: req.businessId, subscriptionId: sub.id, from: 'active', to: 'active', planId: plan.id, previousPlanId: sub.plan_id });
        }
        await request.update({ subscription_id: sub.id }, { transaction });
        return { request, updated: false };
      });

      const data = await SubscriptionRequest.findByPk(request.id, { include: [...fullInclude, subscriptionInclude] });

      if (updated) {
        realtime.emitToBusiness(data.business_id, 'subscription_request:updated', { id: data.id, status: data.status });
      }
      notifySuperAdmins(
        updated ? 'Subscription request updated' : 'New subscription request',
        `${data.business?.name} ${updated ? 'updated its pending request to' : 'requested'} the "${plan.name}" plan (request #${data.id}).`
      ).catch(e => console.warn('[subscriptionRequest] admin notify failed:', e.message));

      return res.status(updated ? 200 : 201).json({
        success: true,
        message: updated ? 'Pending request updated' : 'Request created',
        data,
      });
    } catch (err) {
      console.error('[subscriptionRequestController.createRequest] Error:', err);
      return fail(res, 500, 'Internal server error');
    }
  },

  /** GET /subscriptions/requests?business_id= — newest first. */
  listBusinessRequests: async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const { count, rows } = await SubscriptionRequest.findAndCountAll({
        where: { business_id: req.businessId },
        include: [...fullInclude, subscriptionInclude],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset,
      });
      return res.status(200).json({ success: true, data: rows, total: count });
    } catch (err) {
      console.error('[subscriptionRequestController.listBusinessRequests] Error:', err);
      return fail(res, 500, 'Internal server error');
    }
  },

  /** PATCH /subscriptions/requests/:id/cancel — only while pending. */
  cancelRequest: async (req, res) => {
    try {
      const request = await SubscriptionRequest.findOne({
        where: { id: req.params.id, business_id: req.businessId },
      });
      if (!request) return fail(res, 404, 'Subscription request not found');
      if (request.status !== 'pending') return fail(res, 409, `Request is already ${request.status}`);

      await sequelize.transaction(async (transaction) => {
        // Conditional so a concurrent approve/reject can't be overwritten.
        const [changed] = await SubscriptionRequest.update(
          { status: 'cancelled' }, { where: { id: request.id, status: 'pending' }, transaction }
        );
        if (!changed) throw Object.assign(new Error('Request is no longer pending'), { status: 409 });
        await closeRequestOnSubscription(request, {
          action: 'request_cancelled', toStatus: 'cancelled', actorId: req.user.id, details: null, transaction,
        });
      });

      const cancelled = await SubscriptionRequest.findByPk(request.id, { include: [...fullInclude, subscriptionInclude] });
      realtime.emitToBusiness(request.business_id, 'subscription_request:updated', { id: request.id, status: 'cancelled' });
      return res.status(200).json({ success: true, data: cancelled });
    } catch (err) {
      if (err.status) return fail(res, err.status, err.message);
      console.error('[subscriptionRequestController.cancelRequest] Error:', err);
      return fail(res, 500, 'Internal server error');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ADMIN PANEL (Super Admin only)
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /admin/subscription-requests?status=&business_id=&plan_id=&search=&limit=&offset= */
  adminList: async (req, res) => {
    try {
      const { status, business_id, plan_id, search } = req.query;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const where = {};
      if (status && status !== 'all') where.status = status.split(',');
      if (business_id) where.business_id = business_id;
      if (plan_id) where.plan_id = plan_id;
      if (search) {
        const like = { [Op.like]: `%${search}%` };
        where[Op.or] = [
          { '$business.name$': like },
          { '$requester.name$': like },
          { '$requester.email$': like },
          { payment_reference: like },
        ];
      }

      const { count, rows } = await SubscriptionRequest.findAndCountAll({
        where,
        include: fullInclude,
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset,
        subQuery: false,
        distinct: true,
      });
      return res.status(200).json({ success: true, data: rows, total: count });
    } catch (err) {
      console.error('[subscriptionRequestController.adminList] Error:', err);
      return fail(res, 500, 'Internal server error');
    }
  },

  /** GET /admin/subscription-requests/:id */
  adminGet: async (req, res) => {
    try {
      const request = await SubscriptionRequest.findByPk(req.params.id, {
        include: [...fullInclude, subscriptionInclude],
      });
      if (!request) return fail(res, 404, 'Subscription request not found');
      return res.status(200).json({ success: true, data: request });
    } catch (err) {
      console.error('[subscriptionRequestController.adminGet] Error:', err);
      return fail(res, 500, 'Internal server error');
    }
  },

  /**
   * POST /admin/subscription-requests/:id/approve
   * One transaction: the business's single subscription row becomes active on
   * the requested plan with the new period, the request is marked reviewed, and
   * the change is written to the history. Row lock stops a double approve.
   */
  adminApprove: async (req, res) => {
    const { error, value } = approveSchema.validate(req.body || {}, { abortEarly: false });
    if (error) return validationFail(res, error);

    let request;
    try {
      await sequelize.transaction(async (t) => {
        request = await SubscriptionRequest.findByPk(req.params.id, {
          include: [{ model: Plan, as: 'plan' }],
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        if (!request) throw Object.assign(new Error('Subscription request not found'), { status: 404 });
        if (request.status !== 'pending') {
          throw Object.assign(new Error(`Request is already ${request.status}`), { status: 409 });
        }

        const now = new Date();
        const startsAt = value.starts_at ? new Date(value.starts_at) : now;
        const endsAt = value.ends_at ? new Date(value.ends_at) : addInterval(startsAt, request.plan.interval);
        if (endsAt <= startsAt) throw Object.assign(new Error('ends_at must be after starts_at'), { status: 400 });

        const fields = {
          status: 'active',
          plan_id: request.plan_id,
          current_period_start: startsAt,
          current_period_end: endsAt,
          ends_at: endsAt,
          canceled_at: null,
          trial_ends_at: null,
        };
        const ctx = {
          action: 'approved',
          actorId: req.user.id,
          requestId: request.id,
          details: { admin_note: value.admin_note || null, starts_at: startsAt, ends_at: endsAt },
          transaction: t,
        };
        let subscription = await subscriptions.getForBusiness(request.business_id, { lock: t.LOCK.UPDATE, transaction: t });
        if (subscription) await subscriptions.transition(subscription, fields, ctx);
        else subscription = await subscriptions.createForBusiness(request.business_id, fields, ctx);

        await request.update({
          status: 'approved',
          subscription_id: subscription.id,
          admin_note: value.admin_note || null,
          reviewed_by: req.user.id,
          reviewed_at: now,
        }, { transaction: t });
      });
    } catch (err) {
      if (err.status) return fail(res, err.status, err.message);
      console.error('[subscriptionRequestController.adminApprove] Error:', err);
      return fail(res, 500, 'Internal server error');
    }

    const approved = await SubscriptionRequest.findByPk(request.id, {
      include: [...fullInclude, subscriptionInclude],
    });
    notifyRequester(
      approved, 'subscription_request:approved', 'Your plan request was approved',
      `Your request for the "${approved.plan?.name}" plan is approved and active until ${approved.subscription.ends_at.toISOString()}.`
    ).catch(e => console.warn('[subscriptionRequest] notify failed:', e.message));

    return res.status(200).json({ success: true, data: approved });
  },

  /** POST /admin/subscription-requests/:id/reject  { reason } */
  adminReject: async (req, res) => {
    try {
      const { error, value } = rejectSchema.validate(req.body || {}, { abortEarly: false });
      if (error) return validationFail(res, error);

      const request = await SubscriptionRequest.findByPk(req.params.id);
      if (!request) return fail(res, 404, 'Subscription request not found');

      // Conditional update so a concurrent approve/reject can't both win.
      const changed = await sequelize.transaction(async (transaction) => {
        const [n] = await SubscriptionRequest.update(
          { status: 'rejected', reject_reason: value.reason, reviewed_by: req.user.id, reviewed_at: new Date() },
          { where: { id: request.id, status: 'pending' }, transaction }
        );
        if (n) {
          await closeRequestOnSubscription(request, {
            action: 'rejected', toStatus: 'rejected', actorId: req.user.id, details: { reason: value.reason }, transaction,
          });
        }
        return n;
      });
      if (!changed) return fail(res, 409, `Request is already ${request.status}`);

      const rejected = await SubscriptionRequest.findByPk(request.id, { include: [...fullInclude, subscriptionInclude] });
      notifyRequester(
        rejected, 'subscription_request:rejected', 'Your plan request was rejected',
        `Your request for the "${rejected.plan?.name}" plan was rejected. Reason: ${value.reason}`
      ).catch(e => console.warn('[subscriptionRequest] notify failed:', e.message));

      return res.status(200).json({ success: true, data: rejected });
    } catch (err) {
      console.error('[subscriptionRequestController.adminReject] Error:', err);
      return fail(res, 500, 'Internal server error');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  EXPIRY JOB
  // ══════════════════════════════════════════════════════════════════════════

  /** Active subscriptions past ends_at become expired. Returns rows changed. */
  expireManualSubscriptions: subscriptions.expireDue,

  addInterval,
};
