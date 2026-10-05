'use strict';

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');

// Protect all routes
router.use(authenticate);

// ─── User Profile (CA05) ────────────────────────────────────────────────────────
router.get('/me', userController.getProfile);
router.patch('/me', userController.updateProfile);

module.exports = router;
