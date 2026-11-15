'use strict';

const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { Subscription, SubscriptionHistory } = require('../../models');

/**
 * Manual billing.
 *
 * `subscriptions` holds ONE row per business: its current state.
 *   status: pending | active | cancelled | expired | rejected
 * `subscription_histories` is the append-only log of every change to that row
 * (and of request events that leave the status unchanged, e.g. an upgrade
 * requested while a plan is active). Every change goes through transition()
 * or log(), so nothing changes without a history entry.
 */
const STATUSES = ['pending', 'active', 'cancelled', 'expired', 'rejected'];

// subscriptions.stripe_subscription_id is NOT NULL + unique (Stripe era); manual rows get a synthetic id.
const manualId = () => `manual_${randomUUID()}`;

/** The business's subscription row (any status), or null. */
const getForBusiness = (businessId, options = {}) =>
  Subscription.findOne({ where: { business_id: businessId }, ...options });

/** The business's subscription only while it is active, or null. */
const findCurrent = (businessId, options = {}) =>
  Subscription.findOne({ where: { business_id: businessId, status: 'active' }, ...options });

/** Write one history entry. */
const log = ({ businessId, subscriptionId = null, requestId = null, action, from = null, to = null, planId = null, previousPlanId = null, actorId = null, details = null, transaction }) =>
  SubscriptionHistory.create({
    business_id: businessId,
    subscription_id: subscriptionId,
    subscription_request_id: requestId,
    action,
    from_status: from,
    to_status: to,
    plan_id: planId,
    previous_plan_id: previousPlanId,
    actor_id: actorId,
    details,
  }, { transaction });

/** Update the subscription row and record the change. */
const transition = async (sub, changes, { action, actorId = null, requestId = null, details = null, transaction }) => {
  const from = sub.status;
  const previousPlanId = sub.plan_id;
  await sub.update(changes, { transaction });
  await log({
    businessId: sub.business_id,
    subscriptionId: sub.id,
    requestId,
    action,
    from,
    to: sub.status,
    planId: sub.plan_id,
    previousPlanId: previousPlanId !== sub.plan_id ? previousPlanId : null,
    actorId,
    details,
    transaction,
  });
  return sub;
};

/** Create the business's subscription row (first time) and record it. */
const createForBusiness = async (businessId, fields, { action, actorId = null, requestId = null, details = null, transaction }) => {
  const sub = await Subscription.create({
    ...fields,
    business_id: businessId,
    stripe_subscription_id: manualId(),
  }, { transaction });
  await log({
    businessId, subscriptionId: sub.id, requestId, action, from: null, to: sub.status,
    planId: sub.plan_id, actorId, details, transaction,
  });
  return sub;
};

/** Fields that describe a running period; cleared when a business goes back to pending. */
const NO_PERIOD = { current_period_start: null, current_period_end: null, ends_at: null, canceled_at: null, trial_ends_at: null };

/** Active subscriptions past ends_at become expired (one history entry each). Returns rows changed. */
const expireDue = async () => {
  const due = await Subscription.findAll({ where: { status: 'active', ends_at: { [Op.lt]: new Date() } }, limit: 500 });
  for (const sub of due) {
    await transition(sub, { status: 'expired' }, { action: 'expired', details: { ends_at: sub.ends_at } });
  }
  return due.length;
};

module.exports = {
  STATUSES, NO_PERIOD, manualId, getForBusiness, findCurrent, log, transition, createForBusiness, expireDue,
};
