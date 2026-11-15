'use strict';

const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const passport = require('passport');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const authenticate = require('../middleware/authenticate');
const authorizeBusiness = require('../middleware/authorizeBusiness');
const requestController = require('../controllers/subscriptionRequestController');

// Payment receipt: image or PDF, max 5 MB, served from /public/uploads/receipts.
const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../public/uploads/receipts');
      require('fs').mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
    cb(ok ? null : Object.assign(new Error('receipt must be a JPG, PNG, WEBP or PDF'), { status: 400 }), ok);
  },
}).single('receipt');

const handleReceipt = (req, res, next) =>
  receiptUpload(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'receipt must be 5 MB or smaller' : err.message;
    return res.status(400).json({ success: false, message: 'Validation failed', details: [message] });
  });

// ─── Subscription requests (manual approval) ─────────────────────────────────
// Declared before the loose JWT middleware and `/:id` so these use the strict guards.
router.post('/requests', authenticate, handleReceipt, authorizeBusiness, requestController.createRequest);
router.get('/requests', authenticate, authorizeBusiness, requestController.listBusinessRequests);
router.patch('/requests/:id/cancel', authenticate, authorizeBusiness, requestController.cancelRequest);

router.use((req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    req.user = user;
    next();
  })(req, res, next);
});

// ─── Subscriptions CRUD ──────────────────────────────────────────────────────
// Stripe Checkout disabled: plans now go through /subscriptions/requests (manual approval).
// router.post('/checkout', subscriptionController.createCheckoutSession);
// router.get('/checkout/confirm', subscriptionController.confirmCheckout);
router.post('/create', subscriptionController.createSubscription);
router.get('/', subscriptionController.getSubscriptions);
router.get('/business/:businessUuid', subscriptionController.getBusinessSubscription);
router.get('/:uuid', subscriptionController.getSubscriptionById);
router.put('/:uuid', subscriptionController.updateSubscription);
router.patch('/:uuid/cancel', subscriptionController.cancelSubscription);

module.exports = router;
