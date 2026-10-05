'use strict';

const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const passport = require('passport');

router.use((req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    req.user = user;
    next();
  })(req, res, next);
});

// ─── Subscriptions CRUD ──────────────────────────────────────────────────────
router.post('/checkout', subscriptionController.createCheckoutSession);
router.get('/checkout/confirm', subscriptionController.confirmCheckout);
router.post('/', subscriptionController.createSubscription);
router.get('/', subscriptionController.getSubscriptions);
router.get('/business/:businessId', subscriptionController.getBusinessSubscription);
router.get('/:id', subscriptionController.getSubscriptionById);
router.put('/:id', subscriptionController.updateSubscription);
router.patch('/:id/cancel', subscriptionController.cancelSubscription);

module.exports = router;
