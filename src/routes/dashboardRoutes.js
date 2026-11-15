'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const authorizeBusiness = require('../middleware/authorizeBusiness');
const ctrl = require('../controllers/dashboardController');

// All take ?business_id=&from=YYYY-MM-DD&to=YYYY-MM-DD (UTC, inclusive) &channel=
router.use(authenticate, authorizeBusiness);

router.get('/summary', ctrl.summary);
router.get('/message-volume', ctrl.messageVolume);
router.get('/team-performance', ctrl.teamPerformance);

module.exports = router;
