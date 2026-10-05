'use strict';

const { Subscription } = require('../../models');

const toDate = (unix) => (unix ? new Date(unix * 1000) : null);

/**
 * Upsert a local Subscription row from a Stripe subscription object.
 * Shared by the webhook and the checkout success callback so both paths
 * produce identical data (and are idempotent if both fire).
 */
async function syncStripeSubscription(stripeSub, { business_id, plan_id } = {}) {
  // Newer Stripe API versions moved period dates onto the subscription item.
  const item = stripeSub.items && stripeSub.items.data && stripeSub.items.data[0];
  const periodStart = stripeSub.current_period_start || (item && item.current_period_start);
  const periodEnd = stripeSub.current_period_end || (item && item.current_period_end);

  const fields = {
    stripe_status: stripeSub.status,
    current_period_start: toDate(periodStart),
    current_period_end: toDate(periodEnd),
    trial_ends_at: toDate(stripeSub.trial_end),
    ends_at: toDate(stripeSub.cancel_at),
    canceled_at: toDate(stripeSub.canceled_at),
  };

  let sub = await Subscription.findOne({ where: { stripe_subscription_id: stripeSub.id } });
  if (!sub && business_id) {
    // Same business re-subscribing (e.g. plan change) — reuse its row.
    sub = await Subscription.findOne({ where: { business_id }, order: [['created_at', 'DESC']] });
  }

  if (sub) {
    await sub.update({
      ...fields,
      stripe_subscription_id: stripeSub.id,
      ...(plan_id ? { plan_id } : {}),
    });
    return sub;
  }

  if (!business_id || !plan_id) return null;
  return Subscription.create({
    business_id,
    plan_id,
    stripe_subscription_id: stripeSub.id,
    ...fields,
  });
}

module.exports = { syncStripeSubscription };
