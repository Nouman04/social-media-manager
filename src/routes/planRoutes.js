'use strict';

const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');
const passport = require('passport');

router.use((req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    req.user = user;
    next();
  })(req, res, next);
});

// ─── Plans CRUD ──────────────────────────────────────────────────────────────
router.post('/', planController.createPlan);
router.get('/', planController.getPlans);
router.get('/:uuid', planController.getPlanById);
router.put('/:uuid', planController.updatePlan);
router.delete('/:uuid', planController.deletePlan);

module.exports = router;
