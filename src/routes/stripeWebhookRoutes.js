'use strict';

const express = require('express');
const router = express.Router();
const stripeWebhookController = require('../controllers/stripeWebhookController');

// We need raw body for Stripe signature verification
// Notice the route is just '/', which will be mounted at '/api/v1/stripe/webhook'
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookController.handleWebhook
);

module.exports = router;
