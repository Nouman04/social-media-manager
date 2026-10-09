'use strict';

const stripe = process.env.STRIPE_SECRET ? require('stripe')(process.env.STRIPE_SECRET) : null;
const { Subscription } = require('../../models');
const { syncStripeSubscription } = require('../services/stripeSubscriptionSync');

module.exports = {
  handleWebhook: async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      if (endpointSecret) {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      } else {
        // Fallback for development without webhook secret validation
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error('[stripeWebhookController] Webhook signature verification failed.', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          
          if (session.mode === 'subscription' && session.metadata && session.metadata.business_id && session.metadata.plan_id) {
            const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
            await syncStripeSubscription(stripeSub, {
              business_id: session.metadata.business_id,
              plan_id: session.metadata.plan_id,
            });
          }
          break;
        }

        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          await syncStripeSubscription(event.data.object);
          break;
        }
        
        case 'invoice.paid': {
          const invoice = event.data.object;
          if (invoice.subscription) {
            const sub = await Subscription.findOne({ where: { stripe_subscription_id: invoice.subscription } });
            if (sub) {
              sub.stripe_status = 'active'; // Payment successful
              await sub.save();
            }
          }
          break;
        }
        
        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          if (invoice.subscription) {
            const sub = await Subscription.findOne({ where: { stripe_subscription_id: invoice.subscription } });
            if (sub) {
              sub.stripe_status = 'past_due';
              await sub.save();
            }
          }
          break;
        }

        default:
          console.log(`Unhandled event type ${event.type}`);
      }
    } catch (err) {
      console.error('[stripeWebhookController] Error handling event:', err);
      // Return 500 to tell Stripe to retry
      return res.status(500).json({ error: 'Internal Server Error processing webhook' });
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
  }
};
