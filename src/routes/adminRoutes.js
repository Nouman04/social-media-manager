'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const ctrl = require('../controllers/subscriptionRequestController');

router.use(authenticate, requireSuperAdmin);

// ─── Subscription requests (manual approval) ────────────────────────────────
router.get('/subscription-requests', ctrl.adminList);
router.get('/subscription-requests/:id', ctrl.adminGet);
router.post('/subscription-requests/:id/approve', ctrl.adminApprove);
router.post('/subscription-requests/:id/reject', ctrl.adminReject);

// ─── Subscription history of one business (by business uuid) ────────────────
router.get('/businesses/:uuid/subscription-history', require('../controllers/subscriptionController').getBusinessSubscriptionHistory);

module.exports = router;
